"""A throwaway SMTP server for tests: accepts everything and appends each message to a file.

Usage: python3 smtp_sink.py PORT LOGFILE
"""
import socketserver, sys
class H(socketserver.StreamRequestHandler):
    def handle(self):
        w=lambda s: self.wfile.write((s+"\r\n").encode())
        w("220 sink ESMTP")
        data=False; buf=[]
        for raw in self.rfile:
            line=raw.decode(errors="replace").rstrip("\r\n")
            if data:
                if line==".":
                    data=False; open(sys.argv[2],"a").write("\n".join(buf)+"\n====\n"); buf=[]; w("250 queued")
                else: buf.append(line)
                continue
            cmd=line.upper()
            if cmd.startswith("EHLO"): w("250-sink"); w("250 8BITMIME")
            elif cmd.startswith("DATA"): data=True; w("354 go")
            elif cmd.startswith("QUIT"): w("221 bye"); return
            else: w("250 ok")
socketserver.ThreadingTCPServer.allow_reuse_address=True
socketserver.ThreadingTCPServer(("127.0.0.1",int(sys.argv[1])),H).serve_forever()
