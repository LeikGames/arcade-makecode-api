// Game for test/run.mjs. Takes commands on, and reports to, its own message channel.
const CHANNEL = "cabinet-test";

function report(o: any): void {
    control.simmessages.send(CHANNEL, control.createBufferFromUTF8(JSON.stringify(o)), true);
}

let updates = 0;
let presses = 0;
let menuReleases = 0;
let waited = false;
let blockedWoke = false;

function state(): any {
    return {
        type: "state",
        updates: updates,
        runtime: game.runtime(),
        presses: presses,
        menuReleases: menuReleases,
        waited: waited,
        blockedWoke: blockedWoke,
        paused: cabinet.isPaused(),
        systemMenu: scene.systemMenu.isVisible(),
        sprites: sprites.allOfKind(7).length,
        volume: music.volume(),
        scores: cabinet.highScores()
    };
}

function run(command: string, a: number, b: number): void {
    if (command == "over") cabinet.gameOver(a, b);
    else if (command == "versus") cabinet.gameOverVersus(a, b);
    else if (command == "builtin") { info.setScore(a); game.gameOver(false); }
    else if (command == "builtin2") { info.player2.setScore(a); game.gameOver(true); }
    else if (command == "lives") { info.setScore(a); info.setLife(1); info.changeLifeBy(-1); }
    else if (command == "frameover") game.onUpdate(() => cabinet.gameOver(a));
    else if (command == "push") { game.pushScene(); scene.setBackgroundColor(3); game.onUpdate(() => updates++); }
    else if (command == "pop") game.popScene();
    else if (command == "stray") { const s = sprites.create(image.create(4, 4), 7); s.image.fill(5); }
    else if (command == "wait") { cabinet.wait(a); waited = true; }
    else if (command == "block") { controller.A.pauseUntil(ControllerButtonEvent.Pressed); blockedWoke = true; }
    else if (command == "pausemenu") cabinet.pauseMenu();
    else if (command == "reset") cabinet.resetHighScores();
    else if (command == "state") report(state());
}

control.simmessages.onReceived(CHANNEL, (m: Buffer) => {
    const parts = m.toString().split(" ");
    control.runInParallel(() => run(parts[0], parseFloat(parts[1] || "0"), parseFloat(parts[2] || "0")));
});

// Set by the harness before the program starts
if (settings.exists("nostart")) {
    report({ type: "nostart" });
} else {
    let art: Image = undefined;
    if (settings.exists("art")) { art = image.create(160, 120); art.fill(6); art.fillCircle(80, 60, 40, 2); }
    cabinet.start({ art: art, title: "Ærlig Øl På", howToPlay: "Første linje er ganske lang og må brytes.\nBlåbær, rødgrøt og æøå ÆØÅ.", tableSize: 10 });
    report({ type: "started" });
}

scene.setBackgroundColor(6);
const runner = sprites.create(image.create(16, 16), SpriteKind.Player);
runner.image.fill(2);
controller.player1.moveSprite(runner);
game.onUpdate(() => updates++);
controller.A.onEvent(ControllerButtonEvent.Pressed, () => presses++);
controller.menu.onEvent(ControllerButtonEvent.Released, () => menuReleases++);
