/**
 * Runs the shared screens on top of a suspended game.
 *
 * An overlay pushes a bare event context instead of a scene. MakeCode then
 * stops the game scene's frame loop and event handlers, but game.currentScene()
 * stays the game's own, so sprites created by a fiber that is still running
 * (pause(), setInterval...) end up in the game and not in our menu.
 */
namespace cabinet.internal {
    const REPEAT_DELAY_MS = 400;
    const REPEAT_INTERVAL_MS = 100;

    /** A button of one player, with edges for the current frame. */
    export class ButtonState {
        pressed: boolean;
        /** Released after being pressed on this overlay. */
        released: boolean;
        /** Pressed, or repeating while held. */
        stepped: boolean;
        private down: boolean;
        private armed: boolean;
        private nextRepeat: number;

        constructor(public button: controller.Button) {
            this.down = button.isPressed();
            this.armed = false;
            this.nextRepeat = 0;
        }

        sample(now: number): void {
            const isDown = this.button.isPressed();
            this.pressed = isDown && !this.down;
            this.released = !isDown && this.armed;
            this.stepped = this.pressed;
            if (this.pressed) {
                this.armed = true;
                this.nextRepeat = now + REPEAT_DELAY_MS;
            } else if (isDown && this.armed && now >= this.nextRepeat) {
                this.stepped = true;
                this.nextRepeat = now + REPEAT_INTERVAL_MS;
            }
            if (!isDown) this.armed = false;
            this.down = isDown;
        }
    }

    export class PlayerInput {
        up: ButtonState;
        down: ButtonState;
        left: ButtonState;
        right: ButtonState;
        a: ButtonState;
        b: ButtonState;
        menu: ButtonState;
        all: ButtonState[];

        constructor(c: controller.Controller) {
            this.up = new ButtonState(c.up);
            this.down = new ButtonState(c.down);
            this.left = new ButtonState(c.left);
            this.right = new ButtonState(c.right);
            this.a = new ButtonState(c.A);
            this.b = new ButtonState(c.B);
            this.menu = new ButtonState(c.menu);
            this.all = [this.up, this.down, this.left, this.right, this.a, this.b, this.menu];
        }
    }

    /** Both players' buttons. Choices act on release, so a held A never leaks into the game. */
    export class Input {
        players: PlayerInput[];

        constructor() {
            this.players = [new PlayerInput(controller.player1), new PlayerInput(controller.player2)];
        }

        sample(): void {
            const now = control.millis();
            for (const p of this.players) for (const b of p.all) b.sample(now);
        }

        any(test: (p: PlayerInput) => boolean): boolean {
            return test(this.players[0]) || test(this.players[1]);
        }

        get confirmed(): boolean {
            return this.any(p => p.a.released);
        }
    }

    /** One full-screen page. Set `done` in update() to leave it. */
    export class Screen {
        done: boolean;

        constructor() {
            this.done = false;
        }

        update(input: Input): void { }
        draw(): void { }
    }

    let openOverlays = 0;

    export function overlayOpen(): boolean {
        return openOverlays > 0;
    }

    export class Overlay {
        private context: control.EventContext;
        private current: Screen;
        private heldAtOpen: controller.Button[];

        /** Suspends the game. */
        constructor() {
            openOverlays++;
            game.currentScene(); // make sure there is one below us
            const input = new Input();
            this.heldAtOpen = [];
            for (const p of input.players)
                for (const b of p.all) if (b.button.isPressed()) this.heldAtOpen.push(b.button);

            // Button changes raise "system" events from here on, so code that
            // is blocked in button.pauseUntil() doesn't react to the menu.
            controller._setUserEventsEnabled(false);
            this.context = control.pushEventContext();
            launcher.listen();
            this.context.registerFrameHandler(scene.UPDATE_PRIORITY, () => {
                input.sample();
                if (this.current && !this.current.done) this.current.update(input);
            });
            this.context.registerFrameHandler(scene.RENDER_SPRITES_PRIORITY, () => {
                if (this.current) this.current.draw();
            });
            this.context.registerFrameHandler(scene.UPDATE_SCREEN_PRIORITY, control.__screen.update);
        }

        /** Shows a screen until it is done. */
        show(s: Screen): void {
            this.current = s;
            pauseUntil(() => s.done);
        }

        /** Resumes the game where it was. */
        close(raiseMissedReleases: boolean): void {
            // Don't hand a half-finished button press to the game.
            pauseUntil(() => !anyActionButtonDown(), 2000);
            pauseUntil(() => control.eventContext() === this.context);
            control.popEventContext();
            controller._setUserEventsEnabled(true);
            openOverlays--;
            if (!raiseMissedReleases) return;
            for (const b of this.heldAtOpen)
                if (!b.isPressed()) control.raiseEvent(ControllerButtonEvent.Released, b.id);
        }
    }

    function anyActionButtonDown(): boolean {
        for (const c of [controller.player1, controller.player2])
            if (c.A.isPressed() || c.B.isPressed() || c.menu.isPressed()) return true;
        return false;
    }
}
