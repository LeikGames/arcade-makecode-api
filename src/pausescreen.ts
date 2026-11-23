namespace cabinet.internal {
    const QUIT_TIMEOUT_MS = 3000;
    const SKIP_TITLE_KEY = "cabinet.skiptitle";

    export enum Choice {
        Continue,
        Restart,
        PlayAgain,
        Quit
    }

    function label(c: Choice): string {
        switch (c) {
            case Choice.Continue: return "Fortsett";
            case Choice.Restart: return "Start på nytt";
            case Choice.PlayAgain: return "Spill igjen";
            default: return "Tilbake til spillmenyen";
        }
    }

    /** A vertical menu. The quit choice is only there once the launcher has answered. */
    export class MenuScreen extends Screen {
        choice: Choice;
        private selected: number;

        constructor(private heading: string, private fixedChoices: Choice[], private background: Image) {
            super();
            this.selected = 0;
        }

        private choices(): Choice[] {
            return launcher.isConnected() ? this.fixedChoices.concat([Choice.Quit]) : this.fixedChoices;
        }

        update(input: Input): void {
            const choices = this.choices();
            const n = choices.length;
            if (input.any(p => p.down.stepped)) this.selected = (this.selected + 1) % n;
            else if (input.any(p => p.up.stepped)) this.selected = (this.selected + n - 1) % n;
            if (input.confirmed) this.choose(choices[this.selected]);
            else if (choices[0] == Choice.Continue && input.any(p => p.b.released || p.menu.released))
                this.choose(Choice.Continue);
        }

        private choose(c: Choice): void {
            this.choice = c;
            this.done = true;
        }

        draw(): void {
            if (this.background) screen.drawImage(this.background, 0, 0);
            else draw.starfield();
            const labels = this.choices().map(c => label(c));
            const height = 34 + labels.length * 14;
            const top = (screen.height - height) >> 1;
            screen.fillRect(2, top, screen.width - 4, height, draw.BACKGROUND);
            screen.drawRect(2, top, screen.width - 4, height, draw.TEXT);
            draw.heading(this.heading, top + 6, draw.ACCENT);
            draw.options(labels, this.selected, top + 32);
        }
    }

    /** A plain message, until a timeout if there is one. */
    class MessageScreen extends Screen {
        private start: number;

        constructor(private message: string, private timeoutMs: number) {
            super();
            this.start = control.millis();
        }

        update(input: Input): void {
            if (this.timeoutMs && control.millis() - this.start > this.timeoutMs) this.done = true;
        }

        draw(): void {
            screen.fill(draw.BACKGROUND);
            draw.center(this.message, 56, draw.TEXT);
        }
    }

    /** Asks the launcher to close the game. Returns only if it didn't. */
    export function quit(overlay: Overlay): void {
        scores.settle();
        launcher.sendQuit();
        overlay.show(new MessageScreen("Avslutter ...", QUIT_TIMEOUT_MS));
    }

    /** Restarts the program straight into the game. Never returns. */
    export function restart(overlay: Overlay): void {
        control.runInParallel(() => {
            scores.settle();
            settings.writeNumber(SKIP_TITLE_KEY, 1);
            scores.noteWrite();
            scores.settle();
            control.reset();
        });
        overlay.show(new MessageScreen("Starter ...", 0));
    }

    /** True if the previous run asked for the title screen to be skipped. */
    export function takeSkipTitle(): boolean {
        if (!settings.exists(SKIP_TITLE_KEY)) return false;
        // Not at once: the exported host loses the game's own saves if ours
        // arrives together with them, and games often save at startup.
        control.runInParallel(() => {
            pause(1500);
            settings.remove(SKIP_TITLE_KEY);
            scores.noteWrite();
        });
        return true;
    }
}
