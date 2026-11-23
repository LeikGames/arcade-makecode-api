/** Drawing helpers shared by the screens. All text uses font8, which has æ, ø and å (font5 doesn't). */
namespace cabinet.internal.draw {
    export const BACKGROUND = 15;
    export const TEXT = 1;
    export const DIM = 11;
    export const ACCENT = 5;
    export const FLASH = 4;
    export const PANEL = 8;
    export const SHADOW = 12;

    export const LINE_HEIGHT = 10;
    const CHAR_WIDTH = 6;
    const MAX_CHARS = 25;
    const STARS = 40;

    const font = image.font8;
    const bigFont = image.scaledFont(image.font8, 2);

    export function text(s: string, x: number, y: number, color: number): void {
        screen.print(s, x, y, color, font);
    }

    export function center(s: string, y: number, color: number): void {
        text(s, (screen.width - s.length * CHAR_WIDTH) >> 1, y, color);
    }

    export function right(s: string, x: number, y: number, color: number): void {
        text(s, x - s.length * CHAR_WIDTH, y, color);
    }

    /** Centered; double size with a shadow when it fits, normal size otherwise. */
    export function heading(s: string, y: number, color: number): void {
        const width = s.length * CHAR_WIDTH * 2;
        if (width > screen.width) {
            center(s, y + 4, color);
            return;
        }
        const x = (screen.width - width) >> 1;
        big(s, x + 1, y + 1, SHADOW);
        big(s, x, y, color);
    }

    export function big(s: string, x: number, y: number, color: number): void {
        screen.print(s, x, y, color, bigFont);
    }

    /** Blinking prompt at the bottom of the screen. */
    export function prompt(s: string): void {
        if (control.millis() % 1000 < 700) center(s, 109, TEXT);
    }

    /** A quiet moving starfield, so the screens look alive without any art. Dark colors only: it is behind text. */
    export function starfield(): void {
        screen.fill(BACKGROUND);
        const t = control.millis() / 50;
        for (let i = 0; i < STARS; i++) {
            const depth = 1 + i % 3;
            const shift = Math.floor(t * depth / 3) % screen.width;
            const x = (i * 73 + screen.width - shift) % screen.width;
            screen.setPixel(x, (i * 47 + i * i) % screen.height, depth == 1 ? PANEL : SHADOW);
        }
    }

    /** Menu rows with the selected one highlighted. */
    export function options(labels: string[], selected: number, y: number): void {
        for (let i = 0; i < labels.length; i++) {
            const top = y + i * 14;
            if (i == selected) screen.fillRect(6, top - 3, screen.width - 12, 13, PANEL);
            center(labels[i], top, i == selected ? ACCENT : TEXT);
        }
    }

    /** The table. `highlight` holds the places to flash. */
    export function table(entries: scores.Entry[], highlight: number[]): void {
        center("TOPPLISTE", 3, ACCENT);
        if (entries.length == 0) center("Ingen poeng ennå", 50, DIM);
        for (let i = 0; i < entries.length; i++) {
            const y = 14 + i * 9;
            const marked = highlight.indexOf(i) >= 0;
            const flash = control.millis() % 400 < 200 ? ACCENT : FLASH;
            right("" + (i + 1), 32, y, marked ? flash : DIM);
            text(entries[i].initials, 44, y, marked ? flash : TEXT);
            right("" + entries[i].score, 134, y, marked ? flash : TEXT);
        }
    }

    /** Word-wraps to the screen width. Understands \n; splits words that are too long. */
    export function wrap(s: string): string[] {
        const lines: string[] = [];
        for (const paragraph of s.split("\n")) {
            let line = "";
            for (let word of paragraph.split(" ")) {
                if (line && line.length + 1 + word.length > MAX_CHARS) {
                    lines.push(line);
                    line = "";
                }
                while (word.length > MAX_CHARS) {
                    lines.push(word.substr(0, MAX_CHARS));
                    word = word.substr(MAX_CHARS);
                }
                line = line ? line + " " + word : word;
            }
            lines.push(line);
        }
        return lines;
    }
}
