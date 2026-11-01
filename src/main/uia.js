// Client for native/uia-host.ps1, the long-lived process behind the agent's hands.
import { spawn } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';

const CALL_TIMEOUT_MS = 20000;

export class Uia {
  constructor(nativeDir, excludePid = 0) {
    this.script = path.join(nativeDir, 'uia-host.ps1');
    this.excludePid = excludePid;
    this.proc = null;
    this.nextId = 1;
    this.pending = new Map();
  }

  spawn() {
    if (this.proc) return this.ready;
    const proc = spawn(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-MTA', '-ExecutionPolicy', 'Bypass', '-File', this.script, String(this.excludePid)],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    this.proc = proc;
    let stderr = '';
    this.ready = new Promise((resolve, reject) => {
      readline.createInterface({ input: proc.stdout }).on('line', (line) => {
        const clean = line.replace(/^﻿/, '').trim();
        if (!clean.startsWith('{')) return;
        let msg;
        try { msg = JSON.parse(clean); } catch { return; }
        if (msg.type === 'ready') return resolve();
        const call = this.pending.get(msg.id);
        if (!call) return;
        this.pending.delete(msg.id);
        clearTimeout(call.timer);
        if (msg.ok) call.resolve(msg.result);
        else call.reject(new Error(msg.error));
      });
      proc.stderr.on('data', (d) => { stderr = (stderr + d).slice(-2000); });
      const gone = (reason) => {
        if (this.proc === proc) this.proc = null;
        const err = new Error(reason);
        reject(err);
        for (const call of this.pending.values()) { clearTimeout(call.timer); call.reject(err); }
        this.pending.clear();
      };
      proc.on('error', (err) => gone(`Couldn't start the UI Automation host: ${err.message}`));
      proc.on('exit', (code) => gone(`UI Automation host stopped (code ${code}). ${stderr.trim().slice(-300)}`.trim()));
    });
    return this.ready;
  }

  async call(cmd, args = {}) {
    await this.spawn();
    const id = this.nextId++;
    const proc = this.proc;
    return new Promise((resolve, reject) => {
      // A hung target app would block the host forever, so replace the host.
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('The app stopped responding to UI Automation.'));
        proc?.kill();
      }, CALL_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      proc.stdin.write(`${JSON.stringify({ id, cmd, ...args })}\n`);
    });
  }

  dispose() {
    this.proc?.kill();
    this.proc = null;
  }
}
