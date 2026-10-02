# Remote debug relay

The server side of the web app's remote inspection (`apps/web/src/utils/remoteDebug.ts`, switched on from a
device with `/remotedebug on`).

- `-devices` (default `:8080`) is what devices connect to. Put it behind the web app's reverse proxy under
  `/_rdbg/`, with WebSocket upgrades passed through.
- `-control` (default `:8081`) sends connected devices commands and code. Whoever can reach it can act as the
  person on a connected device, so publish it on the server's loopback only and reach it over ssh.

```
GET  /devices                      who is connected
POST /cmd/<name>?code=<code>       one of the device's commands, arguments as a JSON body
POST /run?code=<code>              code to run on the device: the body of an async function, its return value is the answer
GET  /events?code=<code>&since=<n> what the device logged
```

`code` can be left out while exactly one device is connected.
