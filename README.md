# Classroom Casino

A fun way to call on students. A roulette wheel picks who's next, and that student then plays one hand of blackjack against you, the bank. Win or lose, the table shows what's at stake, like "You may pass the question on" or "You answer the question".

It runs in any web browser. Nothing to install, no account, no internet needed.

## Getting started

1. Download this project (green **Code** button → **Download ZIP**) and unzip it.
2. Double-click **`index.html`**. The game opens in your browser.
3. Press **F** to go fullscreen, and put it on the projector.

The first time, you'll see a few sample names. Click the gear icon in the top right to add your own class.

## Playing in class

1. **Spin the roulette.** Press **Space** or click the wheel. The ball rolls, bounces and lands on a number. Each student has their own number, shown on the board next to the wheel.
2. **Meet the player.** The display announces the number and the student's name.
   - Student not in class today? Press **A** (*Not here*) and the wheel spins again.
3. **Play blackjack.** Press **Enter** to deal. The student decides, you press the key:

   | Key | Move |
   | --- | --- |
   | **H** | Hit (take another card) |
   | **S** | Stand (keep your cards) |
   | **D** | Double (double the bet, take exactly one more card) |
   | **P** | Split (turn a pair into two hands) |

4. **See who won.** The result and the stake appear on the table. Press **N** to spin for the next student, or **R** to play another hand with the same student.

The red numbers at the top keep score: the bank against the class.

### All keys at a glance

| Key | What it does |
| --- | --- |
| **Space** | Spin the roulette |
| **Enter** | Deal the cards / continue |
| **A** | Student not here, spin again |
| **R** | Spin again, or play another hand |
| **N** | Next student |
| **B** | Back to the roulette |
| **F** | Fullscreen |
| **M** | Sound on/off |
| **,** | Open the settings |

## Setting up your class

Click the **gear icon** (or press **,**). Best done before the projector is on.

- **Students**: paste your class list, one name per line. Tick off who's here today. A student's roulette number is their place in the list.
- **Table**: your name as the dealer, and what happens when a student wins, loses or ties.
- **Save & reset**: save your class list to a file, for example to use it on another computer.

Everything is saved automatically in your browser, so your class is still there next time you open the game on the same computer.

## Good to know

- **Works offline.** With internet, the casino fonts load; without it, the game uses similar fonts.
- **Real rules.** Standard blackjack with a 6-deck shoe: blackjack pays 3 to 2, and the dealer draws to 16 and stands on 17. The roulette is a European wheel with numbers 0 to 36.
- **Big classes.** Up to 36 students fit the real roulette wheel. Bigger classes get one pocket per student.
- **Sound.** All sounds are made by the browser, so there are no audio files. Turn them off with **M**.

## What's inside

| File | What it is |
| --- | --- |
| `index.html` | The page you open |
| `css/styles.css` | The look: felt, wood, cards and chips |
| `js/roulette.js` | The roulette wheel and the ball |
| `js/blackjack.js` | The blackjack rules |
| `js/table.js` | Dealing cards, chips and table animations |
| `js/app.js` | Class list, settings and the flow of the game |
| `js/audio.js` | Sound effects |
| `js/fx.js` | Confetti |
