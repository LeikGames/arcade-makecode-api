/**
 * The game side of the launcher protocol. See "Launcher protocol" in README.md.
 */
namespace cabinet.internal.launcher {
    const CHANNEL = "arcade-launcher";
    // Keep in sync with "version" in pxt.json and the git tag.
    const EXT_VERSION = "0.1.0";
    const MAX_MESSAGE_BYTES = 1024;
    const MAX_NESTING = 8;

    // Program state, so it starts out false again after every reset.
    let connected = false;

    /** True once the launcher has answered this run's hello. */
    export function isConnected(): boolean {
        return connected;
    }

    export function sendScore(score: number, initials: string, player: number): void {
        send(JSON.stringify({ v: 1, type: "score", score: score, initials: initials, player: player }));
    }

    export function sendQuit(): void {
        send(JSON.stringify({ v: 1, type: "quit" }));
    }

    /**
     * Listens in the current event context. MakeCode drops a context's handlers
     * while another context is on top, so every new one has to call this.
     */
    export function listen(): void {
        control.simmessages.onReceived(CHANNEL, onMessage);
    }

    function send(json: string): void {
        control.simmessages.send(CHANNEL, control.createBufferFromUTF8(json), true);
    }

    function onMessage(message: Buffer): void {
        try {
            const o = parse(message);
            if (o && o.v === 1 && o.type === "welcome") connected = true;
        } catch (e) {
            // Malformed: ignore.
        }
    }

    function parse(message: Buffer): any {
        if (!message || message.length == 0 || message.length > MAX_MESSAGE_BYTES) return undefined;
        const text = message.toString();
        if (!isSafeObject(text)) return undefined;
        const o = JSON.parse(text);
        return !o || typeof o != "object" || Array.isArray(o) ? undefined : o;
    }

    /**
     * MakeCode's JSON.parse never returns for an unterminated string, so check
     * the structure first: one object, closed strings, balanced and shallow brackets.
     */
    function isSafeObject(text: string): boolean {
        if (text.charAt(0) != "{") return false;
        let depth = 0;
        let inString = false;
        for (let i = 0; i < text.length; i++) {
            const c = text.charAt(i);
            if (inString) {
                if (c == "\\") i++;
                else if (c == "\"") inString = false;
            } else if (c == "\"") {
                inString = true;
            } else if (c == "{" || c == "[") {
                if (++depth > MAX_NESTING) return false;
            } else if (c == "}" || c == "]") {
                if (--depth < 0) return false;
                if (depth == 0) return i == text.length - 1;
            }
        }
        return false;
    }

    // MakeCode has already created the first scene when extensions load, so it
    // needs its own call; the initializer covers every later scene.
    listen();
    scene.Scene.initializers.push(() => listen());
    send(JSON.stringify({ v: 1, type: "hello", ext: EXT_VERSION }));
}
