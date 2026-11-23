/**
 * Shared start screen, pause menu and game-over flow for arcade cabinet games.
 */
//% color="#4b7bec" icon=""
namespace cabinet {
    export enum Player {
        One = 1,
        Two = 2
    }

    export interface StartOptions {
        /** Shown on the start screen. 13 characters or fewer are drawn large. */
        title: string;
        /** Optional instructions, word-wrapped. "\n" starts a new line. */
        howToPlay?: string;
        /** Optional picture: a logo (up to about 150x56), or a background if it is at least 160x120. */
        art?: Image;
        /** Places in the high-score table, 1 to 10. Default 10. */
        tableSize?: number;
    }

    export interface HighScore {
        initials: string;
        score: number;
        player: Player;
    }

    let started = false;
    let over = false;

    /**
     * Shows the start screen and waits for A from either player. Call it first;
     * the game continues below the call. Also turns on the pause menu.
     */
    export function start(options: StartOptions): void {
        if (started) return;
        started = true;
        if (options.tableSize) internal.scores.setTableSize(options.tableSize);

        if (!internal.takeSkipTitle()) {
            const overlay = new internal.Overlay();
            overlay.show(new internal.TitleScreen(options.title || "", options.howToPlay, options.art));
            overlay.close(false);
        }

        // MakeCode keeps one handler per button and event, so this replaces its
        // system menu: in the scene that exists now, and in every later one
        // (MakeCode's own initializer runs before ours).
        installPauseMenu();
        scene.Scene.initializers.push(() => installPauseMenu());
        game.onGameOver(() => gameOverFromInfo());
    }

    /**
     * Ends the game: shows the score, takes initials if it makes the table, then
     * offers another game. The program restarts, so this never returns.
     * @param score the final score; higher is better
     * @param player whose score it is and whose controls enter the initials
     */
    export function gameOver(score: number, player?: Player): void {
        finish([new internal.Result(player == Player.Two ? 2 : 1, internal.scores.normalize(score))]);
    }

    /**
     * Ends a two-player game. Each score that makes the table gets its own
     * initials, entered by that player. Never returns.
     */
    export function gameOverVersus(score1: number, score2: number): void {
        finish([
            new internal.Result(1, internal.scores.normalize(score1)),
            new internal.Result(2, internal.scores.normalize(score2))
        ]);
    }

    /** Like pause(), but time spent in the pause menu doesn't count. */
    export function wait(ms: number): void {
        let left = ms;
        let last = control.millis();
        while (left > 0 || isPaused()) {
            pause(Math.clamp(1, 20, left));
            const now = control.millis();
            if (!isPaused()) left -= now - last;
            last = now;
        }
    }

    /** True while one of the shared screens covers the game. */
    export function isPaused(): boolean {
        return internal.overlayOpen();
    }

    /** Opens the pause menu, as the Menu button does. Returns at once. */
    export function pauseMenu(): void {
        if (over || isPaused()) return;
        control.runInParallel(() => runPauseMenu());
    }

    /** The high-score table, best first. */
    export function highScores(): HighScore[] {
        return internal.scores.load().map(e => {
            const h: HighScore = { initials: e.initials, score: e.score, player: e.player };
            return h;
        });
    }

    /** Empties the high-score table. */
    export function resetHighScores(): void {
        internal.scores.reset();
    }

    function installPauseMenu(): void {
        controller.menu.onEvent(ControllerButtonEvent.Pressed, () => pauseMenu());
        controller.player2.menu.onEvent(ControllerButtonEvent.Pressed, () => pauseMenu());
    }

    function runPauseMenu(): void {
        // Both players can press Menu in the same frame
        if (over || isPaused()) return;
        const overlay = new internal.Overlay();
        const volume = music.volume();
        music.setVolume(0);
        pause(30); // let the game's last frame finish before copying it
        const background = screen.clone();
        while (true) {
            const menu = new internal.MenuScreen("PAUSE",
                [internal.Choice.Continue, internal.Choice.Restart], background);
            overlay.show(menu);
            if (menu.choice == internal.Choice.Continue) break;
            if (menu.choice == internal.Choice.Quit) internal.quit(overlay);
            else internal.restart(overlay);
        }
        music.setVolume(volume);
        overlay.close(true);
    }

    function finish(results: internal.Result[]): void {
        if (over) pauseUntil(() => false); // already ending: park this fiber
        over = true;
        pauseUntil(() => !isPaused()); // ended by a timer while the menu is open
        internal.runGameOver(results);
    }

    /** Safety net for game.over() and friends in games that called start(). */
    function gameOverFromInfo(): void {
        let score1: number = undefined;
        let score2: number = undefined;
        for (const p of info.playersWithScores()) {
            if (p.number == 1) score1 = p.impl.score();
            if (p.number == 2) score2 = p.impl.score();
        }
        if (score1 !== undefined && score2 !== undefined) gameOverVersus(score1, score2);
        else if (score2 !== undefined) gameOver(score2, Player.Two);
        else gameOver(score1);
    }
}
