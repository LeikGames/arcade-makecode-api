namespace cabinet.internal {
    const PAGE_MS = 5000;
    const HOW_TO_LINES = 8;
    const LOGO_HEIGHT = 56;

    /** Title, high scores and how-to-play, rotating until either player presses A. */
    export class TitleScreen extends Screen {
        private page: number;
        private pageStart: number;
        private howTo: string[][];
        private table: scores.Entry[];

        constructor(private title: string, howToPlay: string, private art: Image) {
            super();
            this.page = 0;
            this.pageStart = control.millis();
            this.table = scores.load();
            this.howTo = [];
            if (howToPlay) {
                const lines = draw.wrap(howToPlay);
                for (let i = 0; i < lines.length; i += HOW_TO_LINES)
                    this.howTo.push(lines.slice(i, i + HOW_TO_LINES));
            }
        }

        update(input: Input): void {
            if (input.confirmed) this.done = true;
            const pages = 2 + this.howTo.length;
            if (input.any(p => p.right.pressed)) this.turn(1, pages);
            else if (input.any(p => p.left.pressed)) this.turn(pages - 1, pages);
            else if (control.millis() - this.pageStart > PAGE_MS) this.turn(1, pages);
        }

        private turn(by: number, pages: number): void {
            this.page = (this.page + by) % pages;
            this.pageStart = control.millis();
        }

        draw(): void {
            draw.starfield();
            if (this.page == 0) this.drawTitle();
            else if (this.page == 1) draw.table(this.table, []);
            else this.drawHowTo(this.howTo[this.page - 2]);
            draw.prompt("Trykk A for å starte");
        }

        private drawTitle(): void {
            const art = this.art;
            if (art && art.width >= screen.width && art.height >= screen.height) {
                screen.drawImage(art, (screen.width - art.width) >> 1, (screen.height - art.height) >> 1);
                // Bands keep the text readable on any picture
                screen.fillRect(0, 4, screen.width, 22, draw.BACKGROUND);
                screen.fillRect(0, 105, screen.width, 15, draw.BACKGROUND);
                draw.heading(this.title, 7, draw.ACCENT);
                return;
            }
            let titleY = 34;
            if (art) {
                screen.drawTransparentImage(art, (screen.width - art.width) >> 1, 4 + ((LOGO_HEIGHT - art.height) >> 1));
                titleY = 66;
            }
            draw.heading(this.title, titleY, draw.ACCENT);
            if (this.table.length > 0)
                draw.center("Rekord: " + this.table[0].initials + " " + this.table[0].score, titleY + 24, draw.TEXT);
        }

        private drawHowTo(lines: string[]): void {
            draw.center("SLIK SPILLER DU", 5, draw.ACCENT);
            for (let i = 0; i < lines.length; i++) draw.text(lines[i], 5, 22 + i * draw.LINE_HEIGHT, draw.TEXT);
        }
    }
}
