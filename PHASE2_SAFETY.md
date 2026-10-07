# Phase 2 safety review: the patient app

**Status:** written 2026-10-08, after stages 1 to 5 of `PHASE2_PLAN.md`. The app is **not yet cleared
for real reports.** Section 4 says what has to happen first.

The concept note gates Phase 2 on a safety review. This is it. It covers the local app in `app/`, in
which a patient checks the follow-up recommendations in their own report, on their own computer.
Each hazard below is a way the app could harm someone, with what prevents it and the test that
shows the prevention works. Where nothing fully prevents it, the remaining risk is stated rather
than argued away.

Five hazards were closed by changing the app during this review, and are marked so. A review that
changes nothing has usually not looked.

## 1. Hazard log

Status: **closed** means a design rule prevents it and a test holds the rule. **Mitigated** means the
harm is reduced and the rest is accepted, for the reason given. **Open** means it needs evidence the
app cannot produce on its own, which section 3 is designed to collect.

Test files are in `app/` unless named otherwise.

| ID | Hazard | Harm | What prevents it | Evidence | Remaining risk | Status |
|---|---|---|---|---|---|---|
| H1 | The app misses a recommendation in the report | A follow-up nobody tracks; worse, the patient reads silence as an all-clear | The may-have-missed notice is on every checking screen, even when items were found. The patient can select any sentence and add it. A model that cannot be reached offers manual marking, never an empty result | `checking.test` "every item, the less sure ones in full, and the may-have-missed notice"; "add a recommendation the app missed"; `server.test` "offers the patient the way to mark it themselves" | Measured recall is about 63% (Phase 1). Whether patients read the notice and look for what was missed is unknown | **Open**, the main question for section 3 |
| H2 | The app marks a sentence that asks for nothing | A follow-up chased that was never requested; worry | Nothing becomes a follow-up unless the patient answers yes, beside the highlighted sentence | `checking.test` "only a yes makes an obligation"; "a no makes nothing" | A patient may answer yes to a false item. The cost is a question to a clinic, not a missed duty | Mitigated |
| H3 | A real recommendation the app doubted is overlooked, or an item is never answered | As H1 | The less-sure items are shown in full under their own heading. The page will not save until every item is answered, and since this review **the server refuses too**, so a faulty page cannot skip them | `checking.test` "refuses to save until every item ... has an answer" | None beyond H1 | **Closed in this review** |
| H4 | The wrong date is chosen as the report date, such as a date of birth | Every due date wrong, by years | The patient chooses; each candidate date is shown with its surrounding words; dates that read two ways are flagged; two-digit years are not read. Since this review **the chosen date stays on the checking screen**, with a way back to change it | `extraction/dates.test` (all); `server.test` "nothing is saved without a date" | A patient can still choose the wrong date and not notice | Mitigated; section 3 checks it |
| H5 | A field is invented behind a genuine quote, such as an action or a body part | A follow-up described wrongly | Every field is shown for the patient to correct. A stated interval must be found in the report's own words or it is dropped. Corrections are recorded on the follow-up | `checking.test` "a correction is applied and recorded" | Phase 1 found this class of error and no automatic check for it exists | Mitigated |
| H6 | A conditional recommendation becomes a due date | A duty the report made contingent, asserted as owed | Conditional items are kept as questions for a doctor, never given a due date | `checking.test` "a condition is kept as a question, never a due date" | None | Closed |
| H7 | The condition's wording is missing | The patient cannot see what it depends on | The pipeline does not return the wording separately, so the screen points at the sentence, which contains it, rather than quoting an empty string | Stage 2 in `PHASE2_PLAN.md`; screenshots | The condition is not set apart in the printed summary | Mitigated |
| H8 | A later report is taken as the follow-up when it is not | A real duty closed silently; the dangerous direction | Nothing closes without the patient's yes. A report is never offered as the follow-up of its own follow-ups. A study of another kind of test is never offered. Doubtful matches show why, in plain words | `stage4.test` (all); `obligation/conformance.test` section 4.5 and v0.6 | A patient may say yes to the wrong report | Mitigated; H9 is the undo |
| H9 | A follow-up closed by mistake cannot be reopened | A real duty stays closed | Since this review **a closed follow-up can be reopened** by the patient. The closure stays in its history (specification sections 3.1 and 4.3) | `stage4.test` "closed by mistake can be reopened" | None | **Closed in this review** |
| H10 | Wording interprets a finding, estimates risk, or adds urgency | Fear, false reassurance, or the app becoming a medical device | Every line the patient reads is run through the interpretive-language check in tests. Overdue is a count of days and a question, never urgent | `server.test` "every sentence the patient reads passes"; `stage3.test`; `stage4.test`; `stage5.test` | The check is a word list; meaning can still slip past it. Section 2 reviewed every line by hand | Mitigated |
| H11 | Any failure reads as "nothing found" | False all-clear | An empty paste, an unreachable model, a scanned PDF and a broken PDF each produce their own message and never an empty result | `extraction/pipeline.test` "detection failing is an error"; `server.test`; `stage5.test` | None found | Closed |
| H12 | The file of follow-ups is damaged or lost | Follow-ups disappear without anyone noticing | Writes go to a temporary file first. A file that cannot be read is an error on screen, never an empty list | `server.test` "a damaged store is an error the patient sees" (added in this review) | No backup is made; a deleted file is gone | Mitigated |
| H13 | The report leaves the computer | Privacy breach | The server binds to 127.0.0.1, refuses requests addressed elsewhere, accepts changes only as JSON, and the page loads nothing from outside | `server.test` "not addressed to this computer", "sent as JSON", "loads nothing from outside" | The model server is the patient's own installation | Closed |
| H14 | The report text is kept | Constraint C5 broken | Text is held in memory for one check and dropped at save; only quoted sentences are stored | `server.test` "the report text is gone" | None | Closed |
| H15 | The model stops partway through a report | Items silently dropped | Unverified items stay visible and marked; unfilled ones go to the less-sure list; the reading-stopped notice is shown | `extraction/pipeline.test` (failure cases) | None | Closed |
| H16 | A failed PDF leaves the previous report's text on screen | The wrong report checked under the wrong date | The box is cleared before any PDF is read | `server.test` "choosing a PDF clears the box first" | None | Closed in stage 5 |
| H17 | A PDF's reading order is scrambled | Sentences split or merged, so a quote is wrong | The text is shown to the patient before anything reads it | `stage5.test` | Depends on how each PDF was made | Mitigated |
| H18 | The same report is saved twice | Each follow-up listed twice | Since this review **the patient is told** when follow-ups with the same words and date are already saved. They decide; nothing is merged for them | `server.test` "flagged as possibly saved before" | A patient may save again anyway | **Closed in this review** |
| H19 | The wrong kind of test or body part is given for a later report | A wrong match offered, or a right one missed | Matching only ever proposes; the kind is prefilled from the report; "Not sure" is allowed and leads to a question, never to a closure | `stage4.test` "several doubtful reports make one question" | A wrong answer can hide a real match; the follow-up then stays open, the safe direction | Mitigated |
| H20 | The patient does not open the app again | No reminder ever reaches them | Each due date can go into the patient's own calendar, with a reminder 30 days before | `stage3.test` "the calendar file is a valid all-day event" | A follow-up with no due date gets no calendar entry; the app cannot remind anyone who never returns | **Open**; inherent in a local app with nothing sent anywhere |
| H21 | A follow-up with no date never gets one | It waits forever | After 30 days the status asks the patient to find out when it is due | `stage3.test` "with no due date ... then asks" | Only seen when the app is opened (H20) | Mitigated |
| H22 | The patient fills in details wrongly | A wrong due date | The fields use the report's words; the patient can correct later by reopening and checking the report again | `checking.test` "needs its details from the patient" | Patient-supplied details are not checked against the report | Mitigated |
| H23 | Report text injects markup into the printed page | A page that shows something the report did not say | All report text is escaped | `stage3.test` "escapes them" | None | Closed |
| H24 | Another person on the same computer sees the follow-ups | Privacy | The file is in the user's own home folder | None; operating-system accounts | A shared account shares the file | Mitigated |
| H25 | The patient misunderstands a screen | Any of the above, by a different route | Plain wording, reviewed line by line (section 2) | Section 2 | Unknown until people use it | **Open**, section 3 |
| H26 | The app excludes the people the project is for | No help where help is needed most | Not prevented here: it needs a laptop and a model download. Stated in the plan and the paper | `PHASE2_PLAN.md` section 7 | All of it | Accepted for this phase |
| H27 | The model's own score is read as accuracy | False confidence in an item | Labelled on screen as the model's own number, not a measured accuracy | `checking.test` (score shown, absent for less-sure items) | Some will still read it as a percentage | Mitigated |
| H30 | A real recommendation the model read as negated is never checked | As H1 | Since this review **items read as "not needed" get the same yes or no** as every other item, and count toward the every-item rule | `checking.test` "an item read as not needed is still asked" | None beyond H1 | **Closed in this review** |

The numbers H28 and H29 are unused. H30 keeps the number it was given in the code when it was found,
so that the comments pointing here stay correct.

## 2. Review of every sentence the patient reads

Every string on the page, in the notices, the status lines, the printed summary, the PDF messages and
the closure lines was listed and read: 75 on the page and 25 in the modules. The automated check in
`server.test` covers the page; the module tests cover the rest. Read by hand, three changes followed:

- "Clinician" and "doctor" were both used for the same person. "Doctor" throughout now.
- The heading over items read as negated said they were "not needed", as fact, before the patient had
  checked them. It now says the app read them that way, and asks the patient to check.
- The scanned-PDF message suggested marking the recommendations by hand, which needs text that a scan
  does not provide. It now asks for the text to be typed or pasted.

Two lines were kept after discussion. "App's own score" stays, because R7 of the specification says
confidence is never hidden; the label beside it says it is not an accuracy. "It matches the kind of
test, the part of the body and the timing" stays, because it states which conditions were checked and
says nothing about whether the report is the follow-up, which the patient decides.

## 3. Volunteer test, with invented reports

The open hazards, H1, H4, H20 and H25, are about what people do. Only people can answer them.

**Who.** Six to eight adults with no clinical training, including at least two over 65 and at least
two who rarely use a computer. No patients recruited as patients; nobody uses their own report.

**What they use.** Five invented reports, written for this test and never real:

1. One recommendation with a stated interval, found by the app.
2. Two recommendations, one of which the app does not mark, to see whether the volunteer finds it (H1).
3. A report whose first date is a date of birth (H4).
4. A conditional recommendation, and one the app reads as not needed but which does ask for something
   (H30).
5. A later report that is the follow-up for report 1, and a scanned PDF (H8, H11).

**What is recorded.** For each volunteer and report: whether they found the recommendation the app
missed; whether they chose the report date and not the date of birth; whether they answered the
negated item correctly; whether they confirmed the right later report; and, afterwards, what they
think the may-have-missed notice and the app's own score mean, in their own words. Nothing about the
volunteer's health is asked or recorded.

**What counts as passing, fixed now.** Every volunteer chooses the right report date. Every volunteer
answers the conditional and the negated item correctly. At least three in four find the recommendation
the app missed. Nobody describes the app as having checked their whole report, or describes the score
as an accuracy. Any failure on these means the screen it happened on changes, and the test is run
again on the changed screen.

**How.** Each session one to one, about forty minutes, observed without help unless the volunteer is
stuck for two minutes, which is recorded as a failure on that task. Consent in writing, for taking part
and for notes being kept without names.

## 4. The gate

A real report may go through the app when all of the following hold:

1. Every hazard in section 1 is closed, or mitigated with its remaining risk accepted in writing by the
   project's author.
2. The volunteer test in section 3 has been run and has passed, or its failures have been fixed and
   the affected tasks passed on a second run.
3. The open hazard H20 is written into whatever the patient is told before they start: the app cannot
   remind anyone who does not open it or use the calendar file.
4. Every test passes on the version being released.

None of these holds yet except the last.
