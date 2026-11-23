namespace cabinet.internal {
    const INITIALS_IDLE_MS = 30000;

    /** A score that ended the game. */
    export class Result {
        constructor(public player: number, public score: number) { }
    }

    /** Ignores input at first: players are still mashing buttons when a game ends. */
    class LockedScreen extends Screen {
        private unlockAt: number;

        constructor(lockMs: number) {
            super();
            this.unlockAt = control.millis() + lockMs;
        }

        protected isUnlocked(): boolean {
            return control.millis() >= this.unlockAt;
        }

        update(input: Input): void {
            if (this.isUnlocked() && input.confirmed) this.done = true;
        }
    }

    class ResultScreen extends LockedScreen {
        constructor(private results: Result[]) {
            super(800);
        }

        draw(): void {
            draw.starfield();
            draw.center("SPILLET ER SLUTT", 16, draw.ACCENT);
            if (this.results.length == 1) {
                draw.center("Poeng", 42, draw.DIM);
                draw.heading("" + this.results[0].score, 54, draw.TEXT);
            } else {
                for (let i = 0; i < this.results.length; i++) {
                    draw.text("Spiller " + this.results[i].player, 20, 40 + i * 14, draw.DIM);
                    draw.right("" + this.results[i].score, 140, 40 + i * 14, draw.TEXT);
                }
                const lead = this.results[0].score - this.results[1].score;
                const winner = this.results[lead > 0 ? 0 : 1].player;
                draw.center(lead == 0 ? "Uavgjort!" : "Spiller " + winner + " vant!", 78, draw.ACCENT);
            }
            if (this.isUnlocked()) draw.prompt("Trykk A");
        }
    }

    /** Initials with the owning player's joystick, A and B. */
    class InitialsScreen extends LockedScreen {
        private letters: number[];
        private position: number;
        private lastInput: number;

        constructor(private result: Result, private rank: number) {
            super(300);
            this.letters = [];
            for (let i = 0; i < scores.INITIALS_LENGTH; i++) this.letters.push(0);
            this.position = 0;
            this.lastInput = control.millis();
        }

        initials(): string {
            return this.letters.map(i => scores.ALPHABET.charAt(i)).join("");
        }

        update(input: Input): void {
            const p = input.players[this.result.player - 1];
            if (p.all.some(b => b.stepped)) this.lastInput = control.millis();
            if (this.isUnlocked()) {
                const last = this.letters.length - 1;
                if (p.up.stepped) this.spin(1);
                if (p.down.stepped) this.spin(-1);
                if (p.left.pressed || p.b.released) this.position = Math.max(0, this.position - 1);
                if (p.right.pressed) this.position = Math.min(last, this.position + 1);
                if (p.a.released) {
                    if (this.position == last) this.done = true;
                    else this.position++;
                }
            }
            // A player who walked away must not block the other one
            if (control.millis() - this.lastInput > INITIALS_IDLE_MS) this.done = true;
        }

        private spin(by: number): void {
            const n = scores.ALPHABET.length;
            this.letters[this.position] = (this.letters[this.position] + by + n) % n;
        }

        draw(): void {
            draw.starfield();
            draw.center(this.rank == 0 ? "NY REKORD!" : "PÅ TOPPLISTEN!", 6, draw.ACCENT);
            draw.center("Spiller " + this.result.player + ": " + this.result.score, 20, draw.TEXT);
            draw.center("Skriv initialene dine", 34, draw.DIM);
            for (let i = 0; i < this.letters.length; i++) {
                const x = 45 + i * 28;
                const active = i == this.position;
                draw.big(scores.ALPHABET.charAt(this.letters[i]), x + 2, 62, active ? draw.ACCENT : draw.TEXT);
                screen.fillRect(x, 82, 14, 2, active ? draw.ACCENT : draw.DIM);
                if (!active) continue;
                for (let k = 0; k < 4; k++) {
                    screen.fillRect(x + 6 - k, 52 + k, 2 + 2 * k, 1, draw.ACCENT);
                    screen.fillRect(x + 6 - k, 92 - k, 2 + 2 * k, 1, draw.ACCENT);
                }
            }
            const isLast = this.position == this.letters.length - 1;
            draw.center(isLast ? "A: ferdig  B: tilbake" : "A: neste  B: tilbake", 108, draw.TEXT);
        }
    }

    class TableScreen extends LockedScreen {
        private entries: scores.Entry[];

        constructor(private highlight: number[]) {
            super(500);
            this.entries = scores.load();
        }

        draw(): void {
            draw.starfield();
            draw.table(this.entries, this.highlight);
            if (this.isUnlocked()) draw.prompt("Trykk A");
        }
    }

    /** The whole game-over flow. Never returns: it ends in a reset or a quit. */
    export function runGameOver(results: Result[]): void {
        music.stopAllSounds();
        const overlay = new Overlay();
        overlay.show(new ResultScreen(results));

        // Best first, so an entry can't be pushed out again by the next one.
        const ordered = results.length == 2 && results[1].score > results[0].score
            ? [results[1], results[0]] : results;
        const highlight: number[] = [];
        for (const r of ordered) {
            const rank = scores.rankOf(r.score);
            if (rank < 0) continue;
            const entry = new InitialsScreen(r, rank);
            overlay.show(entry);
            scores.settle(); // two players' saves must not arrive together
            highlight.push(scores.add(new scores.Entry(entry.initials(), r.score, r.player)));
            launcher.sendScore(r.score, entry.initials(), r.player);
        }

        overlay.show(new TableScreen(highlight));
        while (true) {
            const menu = new MenuScreen("Hva nå?", [Choice.PlayAgain], undefined);
            overlay.show(menu);
            if (menu.choice == Choice.Quit) quit(overlay);
            else restart(overlay);
        }
    }
}
