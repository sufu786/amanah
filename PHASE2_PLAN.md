# Phase 2 plan: a patient checks their own report

**Status:** proposed, 2026-10-07. Nothing here is built yet.

Phase 2 of the concept note is the part a person uses: put a report in, check what was found, be
reminded, and carry a prepared summary to a clinician. Its gate is a safety review. Phase 1 measured
the extractor and found it unfit to run unattended. This plan is built around that result rather
than around the extractor we would have liked.

## 1. Three decisions, taken 2026-10-07

| Decision | Choice | Why, and what it costs |
|---|---|---|
| First user | The patient, on their own device | The point of the project, and needs no institution. Costs: no professional sees the doubtful candidates, so the patient checks everything. |
| Platform | A local app in the browser of the patient's own computer, with the model on the same machine | Nothing leaves the machine, which is constraint C5. Costs: a laptop and a 5 GB model download, which excludes most of the people this project is for. Section 7 comes back to this. |
| First input | Pasted text and PDFs that contain text | The measured pipeline runs on text as it is. Photos need OCR, whose errors would feed extraction, and come later. |

## 2. What the patient does

1. Opens the app on their computer and pastes the text of a report, or picks a PDF.
2. Gives the date of the report. If the app finds a date in the text it shows it highlighted and
   asks the patient to confirm it, because every due date is computed from this one value.
3. Waits while the local model reads the report, one sentence at a time. On a laptop CPU this takes
   minutes, and the screen says so rather than pretending otherwise.
4. Checks what was found. Each item is shown beside the report with its sentence highlighted. The
   patient confirms it, corrects it, or says it is not a recommendation. Nothing becomes an
   obligation until they confirm it.
5. Sees, every time, what the app cannot promise: that it may have missed something. They can
   select any sentence in the report and add it as a recommendation the app did not find.
6. Has a list of their obligations, each with what the report asked for in its own words, when it is
   due, and where it stands.
7. Can print the prepared summary, or save it as a PDF, to take to a clinician, and can add each
   due date to their own calendar.
8. Later, when they put in a newer report, the app may ask whether it is the follow-up an open
   obligation was waiting for. The patient answers. Nothing closes on its own.

## 3. What exists and what is new

| Piece | State |
|---|---|
| The obligation: object, states, history, closure rules, ladder, identity | Built and tested (134 tests) |
| Proposals from an extraction, with second tier, conditional and blocked items | Built and tested |
| Prepared summary, and the check that refuses interpretive language | Built and tested |
| Modality codes and the closure proposal for a later study | Built and tested (spec v0.6) |
| The three extraction stages | Built and measured, but only run over a corpus, stage by stage |
| Running all three stages on one report, start to finish | **New** |
| Finding a date in the report for the patient to confirm | **New** |
| The local server and the page the patient uses | **New**, following the pattern of the labelling tool, which already binds to 127.0.0.1 and loads nothing from outside |
| Storage on the patient's computer | **New** |
| Calendar export and a printable summary page | **New** |
| PDF text input | **New**; the PDF library is already a dependency of the document build |

## 4. Safety design

Each constraint in the concept note, and what it means on this screen.

**C1, never interpret.** The app says what the report asks for, in the report's words. It never says
what a finding means. All patient-facing text goes through the existing forbidden-language check, in
tests, so a sentence that interprets cannot ship by accident.

**C2, never imply an all-clear.** When nothing is found, the screen says no follow-up recommendation
was found and that this does not mean there is none. When something is found, the same warning
stays on screen, because Phase 1 measured a recall of about 63%: in a report with two
recommendations, finding one says nothing about the other.

**C3, the patient validates.** Every item is shown beside its highlighted sentence. The patient can
correct any field. The add-a-missed-one control is the direct answer to measured recall: the
patient reads their own report, and the app helps rather than replaces that.

**C4, audit sampling.** A single patient cannot sample anyone's misses. What the app can do is
record, on the patient's machine only, which items they rejected and which they added, so that a
later study with consent could measure misses in real use. Nothing is sent anywhere.

**C5, minimal retention.** The report text is used while the patient checks it, then discarded by
default. The obligation keeps only the quoted sentences, which is what the object always held. Keeping
the full report is an option the patient turns on.

**C6, explicit uncertainty.** Doubted candidates, the second tier of spec section 3.2, are listed
quietly below the main items, since there is no professional to route them to. They never remind or
alert. Conditional recommendations show their condition in the report's words and ask the patient
to raise it with their clinician; they are never turned into a due date (spec section 3).

**The app works without the model.** If the model is not installed, or the patient prefers, they
select the recommendation sentences themselves and the app does everything else. This is also the
fallback when the model fails partway, which the pipeline already refuses to hide.

**No network.** The server listens on 127.0.0.1 only. Its one outbound connection is to the local
model server on the same machine. The page loads nothing from anywhere else.

## 5. Build stages

Each stage ends with tests passing and something that runs. Every stage is developed and tested on
synthetic reports only. No real patient report is put through it until the safety review in stage 6.

1. **One report, start to finish.** `extractReport(text)` runs detection, verification and field
   filling on a single report and returns the shape the obligation layer already accepts, second
   tier included. A date finder offers candidate dates with their positions. Tested on the synthetic
   smoke fixtures, with the model stubbed where the test is about plumbing.
2. **The checking screen.** The local server and page: paste, give the date, wait, then confirm,
   correct or reject each item, add a missed one, and see the nothing-found and may-have-missed
   notices. Confirmed items become obligations through `acceptProposal`, and are saved to a file in
   the patient's own folder.
3. **The list, the summary and the calendar.** Each obligation with its state and ladder level, the
   prepared summary as a printable page, and an `.ics` file per due date.
4. **The follow-up.** Putting in a later report runs `closureProposal` against open obligations. The
   patient confirms or rejects, one proposal at a time, as spec section 4.5 requires. A patient can
   also record that the follow-up happened, which is `patient_attestation`, the lowest evidence tier,
   and shown as such.
5. **PDF input.** Text taken from a PDF, with a clear refusal when the PDF is a scanned image with no
   text in it, since that needs the OCR this phase leaves out.
6. **Safety review, the concept note's gate for this phase.** A written hazard log: each way the app
   could harm someone, what prevents it, and the test that shows it. Every patient-facing sentence
   reviewed. Then a small test with volunteers using synthetic reports, watching where they
   misunderstand. Only after this does a real report go through it.

## 5a. What the stages have found so far

**Stage 1, 2026-10-07.** `extractReport` and `findDates` are built, with tests that stub the model and
run its answers through the real quote check and the real obligation layer. Run once with the real
model on the invented nodule report from the smoke fixtures, the pipeline found the right sentence
and offered the right report date in 108 seconds, and verification then doubted the recommendation
itself, "Recommend CT follow-up in 6 months.", and put it in the second tier. Phase 1 measured this
weakness on real reports: verification doubted 21 real recommendations on the test split.

**What it changes for stage 2.** Section 3.2 of the specification lists second-tier candidates
quietly when the patient is alone. On the checking screen, quietly must not mean out of sight: the
second tier is shown in full beside the first, marked as items the app was less sure about, and the
patient checks them the same way. What stays quiet is everything after: no reminder and no alert for
a second-tier item until the patient confirms it.

**Stage 2, 2026-10-08.** The local app in `app/`: paste a report, choose its date while the model
reads it, check every item beside the highlighted report, add what the app missed, and save. Tested
over real HTTP with the model stubbed, and driven in a headless browser on the invented report. Two
things came out of building it. The pipeline flags a conditional recommendation but never returns
the condition's wording on its own (`validateRecommendation` sets it to null), so the screen points
the patient at the sentence, which contains the condition, rather than quoting an empty string. And
because this runs on a computer the patient also browses the web on, the server refuses requests not
addressed to 127.0.0.1 and accepts changes only as JSON, which a page on another site cannot send.

## 6. Out of scope for Phase 2

Photos and OCR. Phones. Any hosted version. SMS or email reminders. Any language but English. FHIR
connections. Each is a later phase or a separate decision, and none is needed to learn whether a
patient can use this safely.

## 7. Risks this plan does not solve

**Who it reaches.** A laptop, a model download and installing a local model server exclude most of the
people the concept note is written for. The no-model mode lowers the bar but does not remove it.
This phase tests whether the design is safe and usable; reaching people without laptops is the
problem phone and SMS phases exist to solve, and it should not be claimed here.

**Speed.** Several minutes per report on a laptop CPU. Acceptable for a person checking one report,
and stated on screen.

**Misses.** About a third of recommendations are missed. The notices and the add-a-missed-one control
make this visible and correctable. They do not make it go away, and the app must never be described
as finding a patient's follow-ups for them.

**No real person has used any of this.** Stage 6 is where that starts, and its findings may change
stages 2 to 4.
