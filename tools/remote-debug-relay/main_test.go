package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// fakeDevice is what the web app does: say hello, answer commands, fetch and "run" scripts.
func fakeDevice(t *testing.T, ctx context.Context, public *httptest.Server, code string) {
	t.Helper()
	conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(public.URL, "http")+"/_rdbg/device", nil)
	if err != nil {
		t.Fatal(err)
	}
	hello, _ := json.Marshal(map[string]string{"type": "hello", "code": code, "userAgent": "test"})
	if err = conn.Write(ctx, websocket.MessageText, hello); err != nil {
		t.Fatal(err)
	}
	_ = conn.Write(ctx, websocket.MessageText, []byte(`{"type":"event","kind":"console","level":"warn","text":"hi"}`))
	go func() {
		defer conn.CloseNow()
		for {
			_, data, err := conn.Read(ctx)
			if err != nil {
				return
			}
			var cmd struct {
				ID   int64  `json:"id"`
				Name string `json:"name"`
				Args struct {
					Src string `json:"src"`
					Run string `json:"run"`
				} `json:"args"`
			}
			_ = json.Unmarshal(data, &cmd)
			result := any(cmd.Name)
			if cmd.Name == "run" {
				resp, err := http.Get(public.URL + cmd.Args.Src)
				if err != nil {
					return
				}
				script, _ := io.ReadAll(resp.Body)
				resp.Body.Close()
				result = map[string]any{"status": resp.StatusCode, "script": string(script), "run": cmd.Args.Run}
			}
			reply, _ := json.Marshal(map[string]any{"type": "reply", "id": cmd.ID, "ok": true, "result": result})
			_ = conn.Write(ctx, websocket.MessageText, reply)
		}
	}()
}

func TestRelay(t *testing.T) {
	r := &relay{devices: make(map[string]*device), scripts: make(map[string]string)}
	publicMux := http.NewServeMux()
	publicMux.HandleFunc("GET /_rdbg/device", r.handleDevice)
	publicMux.HandleFunc("GET /_rdbg/js/", r.handleScript)
	public := httptest.NewServer(publicMux)
	defer public.Close()
	control := httptest.NewServer(r.control())
	defer control.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	post := func(path, body string) (int, string) {
		resp, err := http.Post(control.URL+path, "application/json", strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		out, _ := io.ReadAll(resp.Body)
		return resp.StatusCode, string(out)
	}
	get := func(base, path string) (int, string) {
		resp, err := http.Get(base + path)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		out, _ := io.ReadAll(resp.Body)
		return resp.StatusCode, string(out)
	}

	if status, body := post("/cmd/info", ""); status != http.StatusNotFound {
		t.Fatalf("a command without a device: %d %s", status, body)
	}

	fakeDevice(t, ctx, public, "ABCD-EFGH")
	deadline := time.Now().Add(5 * time.Second)
	for {
		if _, body := get(control.URL, "/events?code=ABCD-EFGH"); strings.Contains(body, `"text":"hi"`) {
			break
		} else if time.Now().After(deadline) {
			t.Fatalf("the device's event did not arrive: %s", body)
		}
		time.Sleep(20 * time.Millisecond)
	}
	if _, body := get(control.URL, "/devices"); !strings.Contains(body, `"code":"ABCD-EFGH"`) {
		t.Fatalf("devices = %s", body)
	}

	// A fixed command reaches the device and its answer comes back; the only device needs no code.
	if status, body := post("/cmd/info", `{"x":1}`); status != http.StatusOK || !strings.Contains(body, `"result":"info"`) {
		t.Fatalf("cmd: %d %s", status, body)
	}
	if status, _ := post("/cmd/info?code=abcd-efgh", ""); status != http.StatusOK {
		t.Fatal("the code is not case sensitive")
	}
	if status, _ := post("/cmd/info?code=ZZZZ-ZZZZ", ""); status != http.StatusNotFound {
		t.Fatal("another code is another device")
	}
	if status, _ := post("/cmd/info", `not json`); status != http.StatusBadRequest {
		t.Fatal("arguments must be JSON")
	}

	// Code is served to the device as a script of the app's origin, wrapped to report back, exactly once.
	status, body := post("/run", "return 1 + 1")
	var reply struct {
		Result struct {
			Status int    `json:"status"`
			Script string `json:"script"`
			Run    string `json:"run"`
		} `json:"result"`
	}
	if err := json.Unmarshal([]byte(body), &reply); err != nil || status != http.StatusOK || reply.Result.Status != http.StatusOK {
		t.Fatalf("run: %d %s", status, body)
	}
	if !strings.Contains(reply.Result.Script, "return 1 + 1") || !strings.Contains(reply.Result.Script, `window.mxRemoteDebugDone("`+reply.Result.Run+`", true, value)`) {
		t.Errorf("script = %s", reply.Result.Script)
	}
	if status, _ = get(public.URL, "/_rdbg/js/"+reply.Result.Run); status != http.StatusNotFound {
		t.Error("a script is served once")
	}

	// The control side is not part of what the devices' side serves.
	for _, path := range []string{"/devices", "/events", "/run", "/cmd/info"} {
		if status, _ = get(public.URL, path); status != http.StatusNotFound {
			t.Errorf("%s is reachable from the devices' side: %d", path, status)
		}
	}
}
