// Copyright 2026 Maximilian Gaedig
//
// SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial

// The relay for the web app's remote inspection (apps/web/src/utils/remoteDebug.ts).
//
// It has two sides that must stay apart. The device side is public, behind the web app's reverse proxy
// under /_rdbg/: devices that were switched on connect to it and wait. The control side sends them
// commands and code, and listens on its own port that is to be published on the server's loopback only:
// whoever can reach it can act as the person on a connected device.
package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
)

const (
	maxDevices     = 8
	maxMessage     = 512 << 10
	maxCode        = 256 << 10
	maxEvents      = 2000
	commandTimeout = 40 * time.Second
	scriptLifetime = time.Minute
)

type event struct {
	Seq   int64           `json:"seq"`
	Event json.RawMessage `json:"event"`
}

type device struct {
	Code      string    `json:"code"`
	UserAgent string    `json:"user_agent"`
	Remote    string    `json:"remote"`
	Since     time.Time `json:"since"`

	conn *websocket.Conn

	lock    sync.Mutex
	nextID  int64
	waiting map[int64]chan json.RawMessage
	events  []event
	nextSeq int64
}

type relay struct {
	lock    sync.Mutex
	devices map[string]*device
	// scripts are pieces of code waiting to be fetched once by the device they are for.
	scripts map[string]string
}

func token() string {
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		panic(err)
	}
	return hex.EncodeToString(raw)
}

func (r *relay) handleDevice(w http.ResponseWriter, req *http.Request) {
	conn, err := websocket.Accept(w, req, nil)
	if err != nil {
		return
	}
	defer conn.CloseNow()
	conn.SetReadLimit(maxMessage)

	helloCtx, cancel := context.WithTimeout(req.Context(), 10*time.Second)
	_, data, err := conn.Read(helloCtx)
	cancel()
	var hello struct {
		Type      string `json:"type"`
		Code      string `json:"code"`
		UserAgent string `json:"userAgent"`
	}
	if err != nil || json.Unmarshal(data, &hello) != nil || hello.Type != "hello" || len(hello.Code) < 6 || len(hello.Code) > 32 {
		conn.Close(websocket.StatusPolicyViolation, "no hello")
		return
	}
	remote := req.Header.Get("X-Forwarded-For")
	if remote == "" {
		remote = req.RemoteAddr
	}
	dev := &device{
		Code: hello.Code, UserAgent: hello.UserAgent, Remote: remote, Since: time.Now(),
		conn: conn, waiting: make(map[int64]chan json.RawMessage),
	}

	r.lock.Lock()
	if old, ok := r.devices[dev.Code]; ok {
		// The same device coming back (a reload, a dropped connection) takes its place and keeps its log.
		old.lock.Lock()
		dev.events, dev.nextSeq = old.events, old.nextSeq
		old.lock.Unlock()
		old.conn.Close(websocket.StatusGoingAway, "replaced")
	} else if len(r.devices) >= maxDevices {
		r.lock.Unlock()
		conn.Close(websocket.StatusTryAgainLater, "too many devices")
		return
	}
	r.devices[dev.Code] = dev
	r.lock.Unlock()
	log.Printf("device %s connected from %s", dev.Code, remote)

	defer func() {
		r.lock.Lock()
		if r.devices[dev.Code] == dev {
			delete(r.devices, dev.Code)
		}
		r.lock.Unlock()
		log.Printf("device %s disconnected", dev.Code)
	}()

	for {
		_, data, err = conn.Read(req.Context())
		if err != nil {
			return
		}
		var msg struct {
			Type string `json:"type"`
			ID   int64  `json:"id"`
		}
		if json.Unmarshal(data, &msg) != nil {
			continue
		}
		dev.lock.Lock()
		switch msg.Type {
		case "reply":
			if ch, ok := dev.waiting[msg.ID]; ok {
				delete(dev.waiting, msg.ID)
				ch <- data
			}
		case "event":
			dev.nextSeq++
			dev.events = append(dev.events, event{Seq: dev.nextSeq, Event: data})
			if len(dev.events) > maxEvents {
				dev.events = dev.events[len(dev.events)-maxEvents:]
			}
		}
		dev.lock.Unlock()
	}
}

// handleScript serves code to the device it is for, once.
func (r *relay) handleScript(w http.ResponseWriter, req *http.Request) {
	name := strings.TrimPrefix(req.URL.Path, "/_rdbg/js/")
	r.lock.Lock()
	code, ok := r.scripts[name]
	delete(r.scripts, name)
	r.lock.Unlock()
	if !ok {
		http.NotFound(w, req)
		return
	}
	w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = io.WriteString(w, code)
}

var errNoDevice = errors.New("no such device is connected")

// pick finds the device meant: by code, or the only one there is.
func (r *relay) pick(code string) (*device, error) {
	r.lock.Lock()
	defer r.lock.Unlock()
	if code == "" && len(r.devices) == 1 {
		for _, dev := range r.devices {
			return dev, nil
		}
	}
	if dev, ok := r.devices[strings.ToUpper(code)]; ok {
		return dev, nil
	}
	return nil, errNoDevice
}

func (dev *device) command(ctx context.Context, name string, args json.RawMessage) (json.RawMessage, error) {
	if len(args) == 0 {
		args = json.RawMessage("{}")
	}
	dev.lock.Lock()
	dev.nextID++
	id := dev.nextID
	ch := make(chan json.RawMessage, 1)
	dev.waiting[id] = ch
	dev.lock.Unlock()
	defer func() {
		dev.lock.Lock()
		delete(dev.waiting, id)
		dev.lock.Unlock()
	}()

	msg, err := json.Marshal(map[string]any{"type": "cmd", "id": id, "name": name, "args": args})
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, commandTimeout)
	defer cancel()
	if err = dev.conn.Write(ctx, websocket.MessageText, msg); err != nil {
		return nil, err
	}
	select {
	case reply := <-ch:
		return reply, nil
	case <-ctx.Done():
		return nil, errors.New("the device did not answer in time")
	}
}

func fail(w http.ResponseWriter, status int, err error) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": err.Error()})
}

func (r *relay) control() http.Handler {
	mux := http.NewServeMux()
	// Who is connected.
	mux.HandleFunc("GET /devices", func(w http.ResponseWriter, req *http.Request) {
		r.lock.Lock()
		list := make([]*device, 0, len(r.devices))
		for _, dev := range r.devices {
			list = append(list, dev)
		}
		r.lock.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(list)
	})
	// One of the device's fixed commands: POST /cmd/<name>?code=<code> with its arguments as the body.
	mux.HandleFunc("POST /cmd/{name}", func(w http.ResponseWriter, req *http.Request) {
		dev, err := r.pick(req.URL.Query().Get("code"))
		if err != nil {
			fail(w, http.StatusNotFound, err)
			return
		}
		args, err := io.ReadAll(io.LimitReader(req.Body, maxCode))
		if err != nil || (len(args) > 0 && !json.Valid(args)) {
			fail(w, http.StatusBadRequest, errors.New("the arguments are not JSON"))
			return
		}
		reply, err := dev.command(req.Context(), req.PathValue("name"), args)
		if err != nil {
			fail(w, http.StatusGatewayTimeout, err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(reply)
	})
	// Code to run on the device: POST /run?code=<code> with the code as the body. The code is the body of
	// an async function; what it returns is the answer.
	mux.HandleFunc("POST /run", func(w http.ResponseWriter, req *http.Request) {
		dev, err := r.pick(req.URL.Query().Get("code"))
		if err != nil {
			fail(w, http.StatusNotFound, err)
			return
		}
		code, err := io.ReadAll(io.LimitReader(req.Body, maxCode))
		if err != nil {
			fail(w, http.StatusBadRequest, err)
			return
		}
		run := token()
		script := fmt.Sprintf("(async () => {\n%s\n})().then(\n  (value) => window.mxRemoteDebugDone(%q, true, value),\n  (error) => window.mxRemoteDebugDone(%q, false, (error && error.stack) || String(error)),\n);\n", code, run, run)
		r.lock.Lock()
		r.scripts[run] = script
		r.lock.Unlock()
		time.AfterFunc(scriptLifetime, func() {
			r.lock.Lock()
			delete(r.scripts, run)
			r.lock.Unlock()
		})
		args, _ := json.Marshal(map[string]string{"src": "/_rdbg/js/" + run, "run": run})
		reply, err := dev.command(req.Context(), "run", args)
		if err != nil {
			fail(w, http.StatusGatewayTimeout, err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(reply)
	})
	// What the device logged: GET /events?code=<code>&since=<seq>.
	mux.HandleFunc("GET /events", func(w http.ResponseWriter, req *http.Request) {
		dev, err := r.pick(req.URL.Query().Get("code"))
		if err != nil {
			fail(w, http.StatusNotFound, err)
			return
		}
		since, _ := strconv.ParseInt(req.URL.Query().Get("since"), 10, 64)
		dev.lock.Lock()
		out := make([]event, 0, len(dev.events))
		for _, e := range dev.events {
			if e.Seq > since {
				out = append(out, e)
			}
		}
		dev.lock.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(out)
	})
	return mux
}

func main() {
	deviceAddr := flag.String("devices", ":8080", "address the devices connect to, behind the web app's reverse proxy")
	controlAddr := flag.String("control", ":8081", "address of the control side; publish it on loopback only")
	flag.Parse()

	r := &relay{devices: make(map[string]*device), scripts: make(map[string]string)}
	public := http.NewServeMux()
	public.HandleFunc("GET /_rdbg/device", r.handleDevice)
	public.HandleFunc("GET /_rdbg/js/", r.handleScript)

	go func() { log.Fatal(http.ListenAndServe(*controlAddr, r.control())) }()
	log.Printf("devices on %s, control on %s", *deviceAddr, *controlAddr)
	log.Fatal(http.ListenAndServe(*deviceAddr, public))
}
