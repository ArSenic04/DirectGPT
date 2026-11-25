# How this project uses the IFT 6077 course

Collaborative DirectGPT is a **human-centred, multi-person editor**. The AI is only a helper: it makes
suggestions, and people decide, discuss and stay in control. The newest feature, **group review of AI suggestions**,
is entirely human-to-human: teammates vote, comment and approve before a suggestion changes the shared document.

Live demo: <https://collaborative-directgpt.onrender.com/#/collab?session=ift6077-demo&task=sandbox&condition=direct&provider=mock>
(everyone opens the same link and types their own name; no AI key is needed, the demo uses the built-in MOCK provider).

## Course concept, source, and where it shows up in the app

| Course concept | Source | Feature in the app | Try it |
|---|---|---|---|
| **Direct manipulation** | Shneiderman; DirectGPT (CHI 2024) | You select the exact words to change and act on them with a toolbar button, instead of describing the change in a long prompt. The result is visible immediately and can be undone. | Select a sentence, click *Shorten*. |
| **Instrumental interaction** | Beaudouin-Lafon | Commands are reusable *instruments* that act on whatever is selected. Teammates can save their own instruction as a button on a **shared team toolbar**. | Type an instruction, click ☆ Save, check your partner's screen. |
| **Reification** | Beaudouin-Lafon | Things that are usually invisible become objects on screen: the pending **suggestion card**, the **history entry**, the **vote and comment**, the saved **team command**. People can point at them, share them and reuse them. | Open the History tab. |
| **Norman's gulf of execution** | Norman | Select + click makes it easy to say what you want, with no prompt wording to guess. | Compare with the *baseline* (chat) condition on the setup screen. |
| **Norman's gulf of evaluation** | Norman | Every suggestion appears as a **before/after diff** and nothing changes until you accept, so you can judge it before it counts. The group's votes and comments add more evidence to judge by. | Open any suggestion card. |
| **Human control over AI** | Words to Widgets (UIST 2026), VISAR, Textoshop | The AI never edits the document by itself. Only the requester can accept or reject, and anyone can revert. With *Require majority approval before Accept*, the **group** also has a say. | Tick the setting, then try to accept before anyone has voted. |
| **Shared awareness (CSCW)** | CSCW tradition of awareness and coordination | Each person has a colour, cursor and name. Everyone sees who is online, what each person is doing (for example "waiting for the AI"), the text behind a pending request (marked with the requester's name), and a warning when two people select overlapping text. | Open two windows and select overlapping text. |
| **Conflict and shared control** | CSCW; human control | If someone edits the selected text while a suggestion is pending, the card is flagged as a conflict instead of overwriting their work. | Select a paragraph, ask for a change, and type inside it from another window. |
| **Group review of AI suggestions (new)** | CSCW, human control | Teammates give a 👍 or 👎 and leave short comments on a pending suggestion. Everyone sees who voted, in their colour. The requester sees the group's reaction before accepting. Votes and comments sync live and are saved in the history and in the data export. | Next section. |
| **Evaluation methods** | Course papers | A prompt-based chat **baseline**, a post-task questionnaire (Likert and NASA-TLX), a full event log, and metrics such as unintended modifications. | See `docs/STUDY_PROTOCOL.md`. |

## Group review of AI suggestions

1. **Alice** selects a sentence and asks the AI to shorten it. A suggestion card appears for everyone.
2. **Bob** and **Carol** see the card. Each clicks 👍 or 👎 (click again to take it back) and can add a short comment, such as "Keep the word attributed". Alice cannot vote on her own suggestion.
3. Everyone sees the votes with names and colours. Alice sees the group's reaction before she decides.
4. Optional setting **Require majority approval before Accept** (a checkbox in the review panel, shared by the whole session). When it is on, Accept stays disabled until more than half of the teammates who are online have given a 👍, and there are more 👍 than 👎. If nobody else is online, the rule is waived so that a person working alone is never blocked. The requester can always **Reject**.
5. When Alice accepts or rejects, the votes and comments stay attached to the entry in the **History** tab (and in the exported data) with who said what.

Conflict handling is unchanged: if the text changes while people are discussing, the card turns to *conflicted*, and
votes and comments stay visible next to it.

## How to answer the professor

"The AI in our project is only a helper. The main thing is how people work together. In our shared editor,
several people edit one document at the same time. The AI can propose a change, but it never applies it by itself.
Each person has a colour and everyone can see who is online and what they are doing, which is the shared awareness we
studied. When one person asks for an AI change, the others can vote and comment on it, and the group can require that
most people agree before the change goes in. That is human control over the AI, and it is also human-to-human
discussion. We use direct manipulation (select the text and act on it), reusable shared tools on the toolbar
(instrumental interaction), and visible objects for suggestions, history and votes (reification). The preview before
applying a change reduces Norman's gulf of evaluation, and selecting text plus clicking a command reduces the gulf of
execution. We also compare against a plain chat baseline, as the course papers do."
