# arcade-cabinet

A MakeCode Arcade extension that gives every game on our cabinet the same start
screen, pause menu and game-over flow with high scores, and reports scores to
the launcher. Screens are in Norwegian; the API is in English.

## Add it to a game

1. In MakeCode Arcade, open the game → **Extensions** → paste this
   URL, `https://github.com/LeikGames/arcade-makecode-api`.
2. Switch to **JavaScript** and make two calls:

```ts
cabinet.start({ title: "Romsteiner", howToPlay: "Skyt steinene!" })

// ... the game, unchanged ...

info.onLifeZero(() => cabinet.gameOver(info.score()))
```

MakeCode stores the version in `pxt.json` as a git tag
(`"arcade-cabinet": "github:LeikGames/arcade-makecode-api#v0.1.0"`). Games stay on it until
someone updates the extension, so old games never change by themselves.

> **End the game with `cabinet.gameOver`, not MakeCode's `game.over()` or
> `game.gameOver()`.** It is the only call that is sure to reach the high-score
> table and the launcher. After `cabinet.start`, MakeCode's own game over is
> redirected here using the `info` scores, but only as a safety net: it guesses
> whose score it is, and stops working if the game calls `game.onGameOver`.

## API

### `cabinet.start(options)`

Shows the start screen and **blocks** until either player presses A. Put it
first; the game's code simply continues below it. Also turns on the pause menu.

| Option | |
|---|---|
| `title: string` | Up to 13 characters are drawn large. At most 26 fit. |
| `howToPlay?: string` | Word-wrapped; `\n` starts a new line. Long text gets several pages. |
| `art?: Image` | A logo up to about 150×56, or a background if it is at least 160×120. |
| `tableSize?: number` | Places in the high-score table, 1–10. Default 10. |

```ts
cabinet.start({ title: "Stjernejakt", howToPlay: "Samle stjerner!", art: assets.image`logo` })
```

### `cabinet.gameOver(score, player?)`

Score → initials if it makes the table → table → *Spill igjen* / *Tilbake til
spillmenyen*. `player` (`cabinet.Player.One` by default, or `.Two`) is whose
score it is and whose controls enter the initials. **Never returns**: the
program restarts.

```ts
cabinet.gameOver(info.score())                        // one player, or a shared co-op score
cabinet.gameOver(score, cabinet.Player.Two)
```

Co-op games report their shared score as player 1.

### `cabinet.gameOverVersus(score1, score2)`

For two players with a score each. Shows who won. Each score that makes the
table gets its own initials, entered by that player, the higher score first.

Scores are whole numbers and **higher is better**. They are rounded down and
capped at 999 999 999; 0 and below never make the table. On a tie the older
score keeps its place.

### `cabinet.wait(ms)` and `cabinet.isPaused()`

`wait` is `pause()`, except that time in the pause menu doesn't count. See
[Pausing](#pausing).

```ts
control.runInParallel(() => {
    while (true) {
        cabinet.wait(2000)
        spawnEnemy()
    }
})
```

`isPaused()` is true while any shared screen covers the game.

### `cabinet.pauseMenu()`

Opens the pause menu, as the Menu button does.

### `cabinet.highScores()` and `cabinet.resetHighScores()`

```ts
for (const h of cabinet.highScores()) console.log(h.initials + " " + h.score + " P" + h.player)
```

Best first. `resetHighScores()` empties the table.

## Good to know

### The Menu button

MakeCode opens its system menu with a normal `controller.menu.onEvent(Pressed,
...)` handler that it sets in every new scene. There is one handler per button
and event, so `cabinet.start` replaces it, in the current scene and through
`scene.Scene.initializers` in every later one. The system menu then never opens.
Player 2's Menu, which MakeCode ignores, opens the pause menu too.

Don't call `controller.menu.onEvent(ControllerButtonEvent.Pressed, ...)` in a
game: it replaces the pause menu the same way. `addEventListener` is fine. A
game that never calls `cabinet.start` keeps MakeCode's menu.

### Pausing

The shared screens suspend the game by pushing an empty event context, not a
scene. This stops `game.onUpdate`, `onUpdateInterval`, physics, animations,
overlaps, timers based on `game.runtime()`, countdowns and button handlers, and
resumes them where they were.

MakeCode has no way to suspend code that is waiting in `pause()`, or that runs
in `forever`, `game.forever`, `setInterval`, `setTimeout` or
`control.runInParallel`. Such code keeps running. Sprites it creates do end up
in the game, but prefer `game.onUpdateInterval` or `cabinet.wait`. Don't call
`game.pushScene`, `game.popScene` or dialogs from it without checking
`isPaused()`. `control.millis()` keeps counting too; use `game.runtime()`.

Tones and melodies are muted while the menu is open. A song that is already
playing (`music.play(song...)`) keeps sounding.

### Saves

- The table is one setting, `cabinet.scores`: a versioned binary buffer with a
  checksum. Missing or corrupt data reads as an empty table. Wiping a game's
  saves in the launcher clears it.
- **Renaming a MakeCode project clears all its saves**; MakeCode does that.
  `settings.clear()` in a game also clears the table.
- The exported host page **loses a `settings` write that is followed at once by
  another write or a reset**. The extension leaves 500 ms between its own.
  Games that save several values should put them in one setting
  (`settings.writeJSON`), and wait before `game.reset()`.
- A game that fills the 16 KB of settings makes MakeCode erase everything.

### Restart

*Start på nytt* and *Spill igjen* call `control.reset()`, which restarts the
whole program, so a game never has to clean up after itself. The title screen is
skipped once (through a one-time setting, `cabinet.skiptitle`).

### Text and initials

All text uses `image.font8`, which has æ, ø, å, Æ, Ø and Å. `image.font5` has
none of them and is not used. Initials are three characters from A–Z, Æ, Ø, Å
and 0–9. An entry left alone for 30 seconds is confirmed as it stands.

## Launcher protocol

`control.simmessages` on channel `"arcade-launcher"`, always with
`parentOnly = true`. The payload is a UTF-8 JSON object with `"v": 1`, at most
1 KB.

| Direction | Message | When |
|---|---|---|
| Game → launcher | `{"v":1,"type":"hello","ext":"0.1.0"}` | At every program start, so also after every restart. |
| Game → launcher | `{"v":1,"type":"score","score":1234,"initials":"ABC","player":1}` | A score was entered in the table. One per entry. |
| Game → launcher | `{"v":1,"type":"quit"}` | The player chose *Tilbake til spillmenyen*. |
| Launcher → game | `{"v":1,"type":"welcome"}` | The answer to every `hello`. |

- *Tilbake til spillmenyen* is only offered after a `welcome` in this run.
  Nothing is remembered across a reset.
- A game never sends an id. If nothing happens within 3 s of `quit`, the game
  returns to its menu.
- The launcher ignores a game that sends more than 20 messages in 10 seconds.
  The extension never sends in a loop.
- Unknown and malformed messages are ignored. The extension checks the structure
  before parsing, because MakeCode's `JSON.parse` never returns for an
  unterminated string.

For the launcher side: post into the **simulator iframe's window**:
`{type: "messagepacket", channel: "arcade-launcher", data: <Uint8Array>}`.
Two things would break any MakeCode game, and can't be handled in the extension:

- A packet whose `data` is missing or `null`: the simulator's own `Buffer` throws.
- A packet without a `channel`: it blocks the simulator's message queue.

## Development

The demo, `demo.ts`, runs when this repository is opened as a project.

```
npx makecode build -j
```

The tests build everything and play a fixture game in the real simulator, in a
real MakeCode-Arcade-to-App export, with the script as the launcher. They need
Chrome or Edge, and any exported game's folder (for its host page and simulator):

```
cd test
npm install
node run.mjs <exported game folder> [name filter]
```

Pictures of every screen are written to `test/shots/`.

### Release a version

Set the version in **both** `pxt.json` and `EXT_VERSION` in `src/launcher.ts`
(a test compares them), run the tests, commit, then tag and push:

```
git tag v0.1.0
git push origin main v0.1.0
```
