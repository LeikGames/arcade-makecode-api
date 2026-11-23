// Demo game "Stjernejakt": one or two players collect stars and dodge rocks.
// It runs when this repository itself is opened as a MakeCode project.
namespace demo {
    const Star = SpriteKind.create();
    const Rock = SpriteKind.create();

    function shipImage(color: number): Image {
        const im = image.create(12, 12);
        for (let y = 0; y < 12; y++) im.fillRect(5 - (y >> 1), y, 2 + (y >> 1) * 2, 1, color);
        im.fillRect(5, 5, 2, 3, 1);
        return im;
    }

    function ballImage(size: number, color: number): Image {
        const im = image.create(size, size);
        const r = size >> 1;
        im.fillCircle(r, r, r - 1, color);
        im.setPixel(r - 2, r - 2, 1);
        return im;
    }

    function logoImage(): Image {
        const im = image.create(80, 50);
        im.drawTransparentImage(ballImage(22, 5), 8, 4);
        im.drawTransparentImage(ballImage(14, 13), 60, 6);
        im.drawTransparentImage(ballImage(10, 13), 48, 24);
        im.drawTransparentImage(shipImage(9), 34, 36);
        return im;
    }

    // The two cabinet calls: this one, and gameOver at the bottom.
    cabinet.start({
        title: "Stjernejakt",
        howToPlay: "Samle stjerner og unngå steinene!\n\nStyr med spaken.\n\n"
            + "Spiller 2 blir med ved å trykke A.",
        art: logoImage()
    });

    scene.setBackgroundColor(15);
    info.setScore(0);
    info.setLife(3);

    function addShip(player: controller.Controller, x: number, color: number): Sprite {
        const s = sprites.create(shipImage(color), SpriteKind.Player);
        s.setPosition(x, 100);
        s.setStayInScreen(true);
        player.moveSprite(s);
        return s;
    }

    addShip(controller.player1, 50, 9);
    let ship2: Sprite;
    controller.player2.A.onEvent(ControllerButtonEvent.Pressed, () => {
        if (ship2) return;
        ship2 = addShip(controller.player2, 110, 7);
        info.player2.setScore(0);
    });

    function drop(im: Image, kind: number, speed: number): void {
        const s = sprites.create(im, kind);
        s.setPosition(randint(6, 154), 0);
        s.vy = speed;
        s.setFlag(SpriteFlag.AutoDestroy, true);
    }

    const starImage = ballImage(8, 5);
    const rockImage = ballImage(12, 13);
    game.onUpdateInterval(600, () => drop(starImage, Star, 50));
    game.onUpdateInterval(900, () => drop(rockImage, Rock, 50 + Math.min(80, game.runtime() / 500)));

    sprites.onOverlap(SpriteKind.Player, Star, (ship, star) => {
        star.destroy();
        control.runInParallel(() => music.playTone(880, 40));
        if (ship == ship2) info.player2.changeScoreBy(10);
        else info.changeScoreBy(10);
    });

    sprites.onOverlap(SpriteKind.Player, Rock, (ship, rock) => {
        rock.destroy();
        scene.cameraShake(4, 200);
        info.changeLifeBy(-1);
    });

    info.onLifeZero(() => {
        if (ship2) cabinet.gameOverVersus(info.score(), info.player2.score());
        else cabinet.gameOver(info.score());
    });
}
