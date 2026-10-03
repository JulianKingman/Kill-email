import * as net from 'node:net';
import { execFileSync } from 'node:child_process';
import nodemailer from 'nodemailer';

const CONTAINER_NAME = 'kill-email-greenmail-test';
const GREENMAIL_IMAGE = 'greenmail/standalone:2.1.1';

export interface SeedEmailInput {
  from: string;
  to: string;
  subject: string;
  body: string;
}

function runDocker(args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPort(host: string, port: number, timeoutMs: number): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const connected = await new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ host, port });
      socket.once('connect', () => {
        socket.end();
        resolve(true);
      });
      socket.once('error', () => resolve(false));
    });

    if (connected) {
      return;
    }

    await sleep(300);
  }

  throw new Error(`Timed out waiting for ${host}:${port}`);
}

export class GreenMailHarness {
  static readonly imapHost = '127.0.0.1';
  static readonly imapPort = 3143;
  static readonly smtpHost = '127.0.0.1';
  static readonly smtpPort = 3025;
  static readonly username = 'test@local.test';
  static readonly password = 'pass';

  static isDockerAvailable(): boolean {
    try {
      runDocker(['version']);
      return true;
    } catch {
      return false;
    }
  }

  static async start(): Promise<void> {
    if (!this.isDockerAvailable()) {
      throw new Error('Docker is not available');
    }

    try {
      runDocker(['rm', '-f', CONTAINER_NAME]);
    } catch {
      // no-op
    }

    const greenmailOpts = [
      '-Dgreenmail.setup.test.imap',
      '-Dgreenmail.setup.test.smtp',
      `-Dgreenmail.users=${this.username}:${this.password}`,
    ].join(' ');

    runDocker([
      'run',
      '-d',
      '--rm',
      '--name',
      CONTAINER_NAME,
      '-p',
      `${this.imapPort}:3143`,
      '-p',
      `${this.smtpPort}:3025`,
      '-e',
      `GREENMAIL_OPTS=${greenmailOpts}`,
      GREENMAIL_IMAGE,
    ]);

    await waitForPort(this.imapHost, this.imapPort, 20000);
    await waitForPort(this.smtpHost, this.smtpPort, 20000);
  }

  static async stop(): Promise<void> {
    if (!this.isDockerAvailable()) {
      return;
    }

    try {
      runDocker(['rm', '-f', CONTAINER_NAME]);
    } catch {
      // no-op
    }
  }

  static async seedEmail(input: SeedEmailInput): Promise<void> {
    const transporter = nodemailer.createTransport({
      host: this.smtpHost,
      port: this.smtpPort,
      secure: false,
      ignoreTLS: true,
      requireTLS: false,
      tls: {
        rejectUnauthorized: false,
      },
    });

    await transporter.sendMail({
      from: input.from,
      to: input.to,
      subject: input.subject,
      text: input.body,
    });

    transporter.close();
  }
}
