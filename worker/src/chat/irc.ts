import { getLogger, normalizeLogin, type ChatEvent } from "@gta6-clipper/shared";
import WebSocket from "ws";

const IRC_URL = "wss://irc-ws.chat.twitch.tv:443";
const log = getLogger("worker.irc");

export type IrcHandlers = {
  onChat: (event: ChatEvent) => void;
};

export function parseIrcLine(line: string): ChatEvent | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  let tags = "";
  let rest = trimmed;
  if (rest.startsWith("@")) {
    const split = rest.indexOf(" ");
    if (split === -1) return undefined;
    tags = rest.slice(1, split);
    rest = rest.slice(split + 1);
  }
  const priv = rest.match(/^:([^!\s]+)![^ ]+ PRIVMSG #([^\s]+) :(.*)$/u);
  if (!priv) return undefined;
  const userLogin = normalizeLogin(priv[1] ?? "");
  const channelLogin = normalizeLogin(priv[2] ?? "");
  const text = priv[3] ?? "";
  const emoteTag = tags.split(";").find((item) => item.startsWith("emotes="));
  const emoteTokens: string[] = [];
  if (emoteTag && emoteTag !== "emotes=") {
    for (const part of emoteTag.slice("emotes=".length).split("/")) {
      const id = part.split(":")[0];
      if (id) emoteTokens.push(id);
    }
  }
  return {
    channelLogin,
    userLogin,
    text,
    emoteTokens,
    receivedAt: new Date().toISOString(),
  };
}

export class TwitchAnonymousIrc {
  private socket: WebSocket | undefined;
  private shouldRun = false;
  private joins = new Set<string>();
  private attempt = 0;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private readonly nick = `justinfan${Math.floor(10000 + Math.random() * 80000)}`;

  constructor(private readonly handlers: IrcHandlers) {}

  start(): void {
    this.shouldRun = true;
    this.connect();
  }

  stop(): void {
    this.shouldRun = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.close();
    this.socket = undefined;
  }

  join(channelLogin: string): void {
    const login = normalizeLogin(channelLogin);
    this.joins.add(login);
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(`JOIN #${login}`);
    }
  }

  part(channelLogin: string): void {
    const login = normalizeLogin(channelLogin);
    this.joins.delete(login);
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(`PART #${login}`);
    }
  }

  sync(channelLogins: readonly string[]): void {
    const wanted = new Set(channelLogins.map(normalizeLogin));
    for (const login of this.joins) {
      if (!wanted.has(login)) this.part(login);
    }
    for (const login of wanted) {
      if (!this.joins.has(login)) this.join(login);
    }
  }

  private connect(): void {
    if (!this.shouldRun) return;
    log.info({ nick: this.nick }, "Connecting to Twitch IRC anonymously");
    const socket = new WebSocket(IRC_URL);
    this.socket = socket;
    socket.on("open", () => {
      this.attempt = 0;
      socket.send("PASS SCHEME");
      socket.send(`NICK ${this.nick}`);
      socket.send("CAP REQ :twitch.tv/tags");
      for (const login of this.joins) {
        socket.send(`JOIN #${login}`);
      }
    });
    socket.on("message", (data) => {
      const raw = data.toString();
      for (const line of raw.split("\r\n")) {
        if (line.startsWith("PING ")) {
          socket.send(`PONG ${line.slice(5)}`);
          continue;
        }
        const event = parseIrcLine(line);
        if (event) this.handlers.onChat(event);
      }
    });
    socket.on("close", () => {
      this.scheduleReconnect();
    });
    socket.on("error", () => {
      socket.close();
    });
  }

  private scheduleReconnect(): void {
    if (!this.shouldRun) return;
    this.attempt += 1;
    const delay = Math.min(30_000, 500 * 2 ** Math.min(this.attempt, 6));
    log.warn({ attempt: this.attempt, delay }, "IRC disconnected; reconnecting");
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }
}
