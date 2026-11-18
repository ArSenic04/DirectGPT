# Study protocol: Collaborative DirectGPT vs prompt-based AI editing

This protocol puts into practice the evaluation described in the proposal *Collaborative DirectGPT: Direct
Manipulation for Multi-User AI-Assisted Document Editing* (Kachhadiya & Ardeshna, IFT 6077, Université de Montréal).
Every element below is implemented in this repository. File references are given so the procedure can be audited.

## 1. Research questions

Compared with conventional prompt-based AI editing, does direct manipulation **plus** scoped edits, preview and
approval, and per-edit attribution:

- **RQ1 (efficiency):** reduce task time and the number and length of prompts?
- **RQ2 (precision):** reduce **unintended modifications** to the shared document?
- **RQ3 (coordination):** improve awareness and coordination between collaborators?
- **RQ4 (control and transparency):** increase perceived control and transparency of AI changes, without raising workload?

## 2. Design

- **Within-pairs design.** Each pair of participants uses both interfaces.
- **Independent variable: interface** (2 levels).
  - **Direct**: Collaborative DirectGPT. Participants select text, use commands or custom instructions, preview a diff, accept or reject, and can see the shared history, attribution, revert and conflict flags.
  - **Baseline**: prompt-based chat. Each participant has a private chat in which the model sees the whole document. They describe the change and then copy and paste the answer into the shared document.
- **Controlled across conditions:**
  - the same shared editor, presence bar, remote cursors, task panel and timer
  - the same model and provider
  - documents of matched structure (T1 and T2)
- **Counterbalancing:** a balanced Latin square over interface order × document (`shared/counterbalance.ts`). Pair *n* gets order `(n − 1) mod 4`:

| Order | Block 1 | Block 2 |
|---|---|---|
| 1 | Direct, T1 | Baseline, T2 |
| 2 | Baseline, T1 | Direct, T2 |
| 3 | Direct, T2 | Baseline, T1 |
| 4 | Baseline, T2 | Direct, T1 |

  The setup screen shows each pair's order automatically, based on the number in the session ID (`pair01`, `pair02`, …). Recruit a multiple of 4 pairs (we suggest 8 to 12 pairs, that is 16 to 24 participants) to fully balance the design.

## 3. Materials (`shared/tasks.ts`)

| Task | Document | Use |
|---|---|---|
| Practice | Study group note (2 paragraphs) | Training in each condition. Not analysed and has no questionnaire |
| T1 | Community garden newsletter (4 paragraphs) | Study block |
| T2 | Library makerspace announcement (4 paragraphs) | Study block |
| Sandbox | Free text | Demonstrations only |

T1 and T2 are parallel. Each gives **partner A** and **partner B** three items, shown in the left panel. Each item is
an editing request with a known target passage:

- **A1**: shorten a long sentence
- **A2**: fix grammar and spelling mistakes in paragraph 3
- **A3**: make the last sentence more formal
- **B1**: summarize paragraph 1
- **B2**: expand the sentence about the date
- **B3**: make paragraph 3 friendlier

**B3 deliberately targets the same paragraph as A2.** This creates a natural coordination point where concurrent
edits and conflicts can happen. The union of all item targets defines the **intended scope**. Any change outside it
counts as an unintended modification.

## 4. Apparatus

- One computer runs the server with `npm start`. Data is written to `data/rooms` and `data/exports`.
- Each participant uses their own computer or browser window (Chrome or Firefox), seated so they cannot see the other person's screen. Verbal communication is allowed, as in normal co-writing.
- **Provider:** OpenAI-compatible, with `OPENAI_API_KEY` set on the server and the same model (for example `gpt-4o`) in both conditions. The MOCK provider is only for piloting and training rehearsals. All data records which provider produced each suggestion.
- Keep the participants' clocks synced (NTP), because event timestamps come from each client.

## 5. Procedure (about 60 minutes per pair)

1. **Consent and demographics** (5 min): follow the UdeM ethics requirements (CERSES/CER) before recruiting.
2. **Setup** (2 min): the experimenter opens the setup screen and enters the session ID `pairNN`. Each participant's ID (`P01`, `P02`, …), name and role (A/B) can be entered directly, or the experimenter can send each participant a prepared URL:
   `http://HOST:1234/#/collab?session=pair03&task=T1&condition=direct&role=A&pid=P05&name=Alice&provider=openai`
3. **For each block, in the counterbalanced order:**
   1. *Tutorial* (3 min): the experimenter demonstrates the interface on the **Practice** task in that condition.
   2. *Practice* (5 min): both participants complete their practice item.
   3. *Task* (up to 15 min): one partner clicks **Start task**. Each partner completes their three items and coordinates where needed. When both are satisfied, either partner clicks **Finish task**, which ends the timer and disables editing.
   4. *Questionnaire* (3 min): each participant answers individually in the app (section 6.2).
   5. *Export:* the experimenter clicks **Export data** (JSON). The server also keeps a copy in `data/exports/`.
4. **Semi-structured interview** (10 min): ask about preferences, sense of control, awareness of the partner's AI use, and how they handled conflicts or overwrites. Record the interview with consent.

## 6. Measures

### 6.1 Logged behaviour (`shared/metrics.ts`, computed per room and per participant)

| Measure | Definition | RQ |
|---|---|---|
| Task time (s) | From *Start task* to *Finish task* | RQ1 |
| Prompts | AI requests (Direct) or chat messages (Baseline) | RQ1 |
| Prompt length | Typed characters per prompt. A toolbar command counts as 0 | RQ1 |
| Command prompts | Requests made with a toolbar or saved command | RQ1 |
| **Unintended modifications** | Characters changed **outside** the task targets, from a diff of the final text against the initial text | RQ2 |
| Intended changes | Characters changed inside the task targets | RQ2 |
| Accepts / rejects / regenerations | Decisions on suggestions (Direct) | RQ1, RQ4 |
| Conflicts / conflict overrides | Pending requests whose anchored text was changed by a partner, and how often *Apply anyway* was used | RQ3 |
| Overlap warnings | Requests made on text already covered by a partner's pending request | RQ3 |
| Reverts | Accepted AI edits that were undone | RQ2, RQ4 |
| Copies / pastes / pasted characters | Transfer cost in the baseline | RQ1 |
| Manual edit characters | Characters typed or deleted by hand | RQ1 |
| AI errors, latency | To check that both conditions had comparable model service | Control |

Each Direct accept also records `changedOutside`, the number of characters changed outside the request's own anchor.
By construction this is always 0, which is the mechanism behind RQ2.

### 6.2 Questionnaire (`shared/questionnaire.ts`)

Nine 7-point Likert items (1 = strongly disagree, 7 = strongly agree), averaged per construct:

- **Control**: I felt in control of what the AI changed in our document. / I could limit AI changes to exactly the text I intended. / I could easily reject AI changes I did not want.
- **Transparency**: I could tell which parts of the document were changed by the AI. / I knew who requested each AI change. / I could see what the AI was going to change before it was applied.
- **Coordination**: I was aware of what my partner was working on. / My partner's AI edits did not disrupt my own work. / It was easy to coordinate edits with my partner.

**Raw NASA-TLX** (mental, physical and temporal demand, performance, effort, frustration; each 0–100). The raw TLX
score is the mean of the six subscales.

There is also an optional free-text comment.

## 7. Analysis plan (`npm run analyze`, `shared/analysis.ts`)

1. Exclude practice and sandbox rooms. Check that every pair has one Direct and one Baseline block.
2. Compute descriptive statistics for each condition: n, mean, SD and median.
3. Run a **paired, two-sided Wilcoxon signed-rank test** for each measure, Direct vs Baseline. Team-level measures are paired by **session (pair)** and questionnaire measures by **participant**. The test is exact for n ≤ 25 without ties, and otherwise uses a normal approximation with tie and continuity correction. Report V, p and the **matched-pairs rank-biserial r**.
4. Treat RQ1 (task time) and RQ2 (unintended modifications) as primary. Apply a Holm correction across the primary measures and the four questionnaire constructs. Report all other measures as exploratory.
5. Optionally check order and document effects (for example with Mann-Whitney tests on block 1 vs block 2 differences). With a small n, report these descriptively.
6. Analyse the interviews with a thematic analysis of the transcripts, coded by both authors, focusing on authorship, control, awareness and conflict handling (following Lehmann et al.).

`npm run analyze -- --demo` runs the whole pipeline on **synthetic** data, so you can see the outputs before
collecting real data. Never report demo output as results.

## 8. Data management

- Exports contain participant IDs, display names, typed prompts and document text. They contain no API keys. Use pseudonymous IDs and display names.
- Store `data/` on an encrypted disk and delete it according to the ethics approval. `data/` is git-ignored.
- To pilot without spending money or sending data to a third party, use the **MOCK** provider. MOCK suggestions are visibly labelled, so the provider is never in doubt.

## 9. Pilot checklist

- [ ] `npm test` and `npm run test:e2e` pass on the study machine.
- [ ] Two lab machines can reach `http://HOST:1234`. Presence shows both users. Typing syncs.
- [ ] With the real key, one *Shorten* request and one chat request succeed (watch the provider badge).
- [ ] Practice, T1 and T2 rooms export correctly. `npm run analyze` reads them.
- [ ] Clocks synced. Browser zoom at 100%. Notifications off.
