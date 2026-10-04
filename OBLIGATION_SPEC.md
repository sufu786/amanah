# Portable Clinical Obligation, specification v0.5

**Status:** draft for public comment
**Licence:** CC BY 4.0
**Date:** 2026-10-05
**Concept DOI:** [10.5281/zenodo.21706768](https://doi.org/10.5281/zenodo.21706768)

**Changes since v0.4.** An obligation may now exist without a quoted finding, when the report names
none or when no sentence in it can be located as the finding. Every finding records how its quote
was located, and a finding located by nearest match must be confirmed by a person before it can
supersede anything. The identity key gains a rule for obligations with no finding. Section 12.1 E
records what was found and weighed: in a hand-labelled corpus of 500 radiology reports, 14 of 130
follow-up recommendations named no finding, and the v0.4 rule refused every one of them.

**The object format changes, for the first time since v0.2.** The `schema` string becomes
`cor.obligation/0.3`. The change is additive: every valid `cor.obligation/0.2` object is a valid
`cor.obligation/0.3` object with `finding.location` read as `exact`, so stored obligations need no
migration.

**Changes since v0.3.** Section 3.1 is new. A terminal decision that was wrong can be reopened to
`acknowledged` by an actor with a documented reason, and no evidence. Closing needs evidence,
reopening needs only a name, because the dangerous direction is discharge. This settles the last of
the four contradictions found by implementing v0.2, and section 12.1 B records what was weighed and
what was rejected.

**Changes since v0.2.** Three places where v0.2 contradicted itself, all found by writing a
reference implementation against it, were corrected in v0.3: `not_indicated` is a terminal state
and not a route to `resolved`, terminal exits are available from every non-terminal state, and
exhausting the escalation ladder is recorded by a named actor rather than happening by itself.

The object format was unchanged from v0.2 through v0.4, and the `schema` string stayed
`cor.obligation/0.2` across those revisions, because a document revision is not a data format
revision.

Companion to `CONCEPT_NOTE.md`. This document specifies the data object, its state machine, closure
rules and escalation ladder. It is deliberately transport-agnostic: the object can be carried in
JSON, mapped onto FHIR `Task` or `ServiceRequest`, or printed on paper.

**Vendor neutrality.** The reference implementation is named Amanah. This specification is not. The
schema namespace (`cor.`, for clinical obligation registry) and every identifier below are
deliberately product-neutral, so that any party may implement the specification without adopting the
Amanah mark, and so that obligations remain portable between independent implementations.

---

## 1. Design rules

These constrain every decision below.

| # | Rule | Rationale |
|---|---|---|
| R1 | **No implicit state transitions.** Every transition is an event with an actor and a timestamp. | Silent expiry is the failure being fixed. |
| R2 | **No time-based closure.** Elapsed time never closes an obligation. | As above. |
| R3 | **Exactly one owner at all times.** Ownership transfer is an explicit, logged event. | Unowned obligations are the root cause. |
| R4 | **Closure requires evidence** of a declared type. | "Notified" is not the same as "done". |
| R5 | **Verbatim source is retained in the object**, never paraphrased. A field may be absent; it may never be invented. | Non-interpretive guarantee, patient verification, auditability. |
| R6 | **Every recommendation traces to a guideline rule and version.** | Explains why, and allows retrospective correction when guidance changes. |
| R7 | **Confidence is a first-class field, never hidden.** | Below-threshold extraction must be visibly unverified. |
| R8 | **The object is complete without the source document.** | Enables zero retention (constraint C5). |

---

## 2. The object

```jsonc
{
  "schema": "cor.obligation/0.3",
  "id": "uuid-v4",                       // stable, client-generated
  "subject_ref": "opaque-local-id",      // never a national or medical identifier

  "finding": {
    "text_verbatim": "8 mm nodule in the right upper lobe",   // null only with an absence reason
    "category": "pulmonary_nodule",      // controlled vocabulary, see section 7
    "anatomy": "lung.right.upper_lobe",  // optional
    "laterality": "right",               // optional: left, right, bilateral, midline
    "measurement": { "value": 8, "unit": "mm" },   // optional
    "location": "exact",                 // exact, nearest_sentence; see field notes
    "match_score": null,                 // 0 to 1, present only when location is nearest_sentence
    "absence": null,                     // null, not_stated, not_located; see field notes
    "identity_key": "sha256(...)"        // finding identity, see section 6
  },

  "recommendation": {
    "text_verbatim": "recommend CT follow-up in 6 months",
    "action": "imaging",                 // imaging, laboratory, referral,
                                         // treatment_initiation, procedure, specialist_review
    "modality": "CT",                    // free text where not codeable
    "interval": { "value": 6, "unit": "month" },
    "guideline": {                       // null if the recommendation was clinician-stated only
      "id": "fleischner_2017",
      "version": "2017.1",
      "rule": "solid_nodule_6to8mm_low_risk"
    }
  },

  "source": {
    "kind": "photo",                     // fhir, hl7v2, pdf, photo, manual
    "document_date": "2026-03-14",       // date of the REPORT, not of ingestion
    "locator": "page 2, impression",     // human-readable, used in the prepared summary
    "quote_offset": [412, 448],          // character span of text_verbatim within the extract
    "retained": false                    // whether the source document itself was kept
  },

  "due_date": "2026-09-14",              // document_date plus interval; recomputed only on correction
  "due_date_basis": "document_date+interval",

  "owner": {
    "kind": "patient",                   // patient, clinician, coordinator, service
    "ref": "opaque-local-id",
    "since": "2026-03-20T10:04:00Z"
  },

  "state": "acknowledged",               // see section 3
  "extraction": {
    "confidence": 0.91,
    "model": "open-weight-model@1.2.0",
    "language": "en",
    "language_validated": true,          // if false, the UI must show the unvalidated banner (C3)
    "patient_verified": true,
    "patient_corrections": []            // field-level corrections, retained for model audit
  },

  "closure": null,                       // see section 4, populated only in a terminal state
  "history": [ /* see section 5 */ ]
}
```

### Field notes

- **`subject_ref`** is deliberately opaque and local. The registry never requires a national
  identifier, a medical record number, or a name. Global operation across jurisdictions with weak
  data protection depends on this.
- **`document_date`** is the report's own date, never the ingestion date. A photograph of a report
  from two years ago must produce an obligation that is already overdue, not one due in six months.
- **`language_validated: false`** does not block operation. It changes the interface. See C3 in the
  concept note.
- **`finding.location`** says how the quote was found in the source. `exact` means the quote was
  located character for character. `nearest_sentence` means an extractor's quote could not be
  located, and the closest sentence in the source was taken in its place, verbatim, with
  `match_score` recording how close. The extractor's own wording is never retained: R5 is about what
  the object holds, and it holds source text either way. What `nearest_sentence` adds is that a
  machine chose which source text, and could have chosen wrongly, which section 6 rule 4 and
  conformance item 8 deal with. The sentence containing `recommendation.text_verbatim` is never a
  candidate: an extractor returning the recommendation as its own finding has made a recognisable
  error, not a near miss, and the result is `absence: not_located`.
- **`finding.absence`** is set when there is no finding to quote, and `text_verbatim` is then null
  and `category` is `none`. `not_stated` means the report names no abnormality: a benign screening
  mammogram recommending the next annual round, or a normal study recommending further imaging if
  symptoms persist. `not_located` means the report does name one but no sentence could be located
  with enough confidence to stand as the quote. The two are kept apart because the second is an
  extraction failure a person can repair and the first is not. Where there is no finding,
  `finding.anatomy` and `finding.laterality` carry the body part and side the recommendation itself
  names, if any: "annual mammography of the left breast" gives `breast` and `left`. They are null
  where the recommendation names neither, and are never inferred from the type of study.
- **`patient_corrections`** is the highest-value training signal the system generates. It should be
  retained at field level, de-identified, even under zero retention of source documents.

---

## 3. State machine

```
   the live path
   -------------
                      +---------------+
                      |    created    |   extraction complete, not yet confirmed
                      +-------+-------+
                              |  verify (patient or clinician confirms fields)
                      +-------v-------+
                      | acknowledged  |
                      +-------+-------+
                              |  schedule
                      +-------v-------+
                      |   scheduled   |
                      +-------+-------+
                              |  evidence of completion (section 4.1)
                      +-------v-------+
                      |   completed   |
                      +-------+-------+
                              |  outcome recorded
                      +-------v-------+
                      |   resolved    |
                      +---------------+

   terminal exits, available from ANY non-terminal state above,
   each requiring a documented reason and an actor
   ------------------------------------------------------------
          --> declined           patient declined, documented
          --> not_indicated      clinician documented follow-up unnecessary
          --> superseded         replaced by a later obligation on the same finding (section 6)
          --> lost_to_followup   escalation ladder exhausted; NOT a closure (section 4.4)
          --> deceased

   reopen, the only way out of a terminal state (section 3.1)
   ----------------------------------------------------------
          any terminal state --> acknowledged
          requires a documented reason and an actor. Requires NO evidence.
```

**Permitted transitions only.** Any transition not drawn above is rejected. In particular there is
no edge from any state to `resolved` that does not pass through recorded evidence.

**`not_indicated` is a terminal state, not a route to `resolved`.** The v0.2 diagram drew it both
ways. Corrected in v0.3; see section 12.1 A. It is still counted as a closure in metrics, so
nothing is lost by the change except the ambiguity, and keeping it distinct preserves the record of
*why* an obligation closed.

**Terminal exits are available from every non-terminal state**, which the v0.2 diagram left to be
inferred from where a line was drawn. A patient may decline before verifying; a finding may be
superseded while its obligation is still in `created`; a patient may die at any point. Restricting
the exits to one state would strand obligations with no lawful way out, which is a worse failure
than the ambiguity it would remove. Stated in words here because the art cannot express it without
becoming unreadable.

### 3.1 Reopening, when a terminal decision was wrong

People record terminal decisions in error. A coordinator marks the wrong obligation
`not_indicated`. A `matching_study` turns out to belong to a different patient. Someone recorded
`lost_to_followup` and the patient walks in six months later. This is not rare, and a specification
that has no answer for it is a specification that will be worked around.

**Any terminal state may be reopened to `acknowledged`**, by an actor, with a documented reason.

**Reopening requires no evidence.** This asymmetry is the point. Closing an obligation requires
evidence of a declared type, because discharge is the dangerous direction. Reopening one requires
only a name and a reason, because it restores a duty rather than discharging one. Making the
conservative operation the hard one would mean mistaken closures persist, which is the harm being
prevented.

**It is not restricted to whoever recorded the closure.** They may have left the service, and if
they made the mistake they are the least likely to notice it.

**The recorded closure is not erased.** It stays in `history` with the actor who recorded it, and
only `closure` on the current view is cleared. Nothing is rewritten, so section 11.6 still holds:
the mistake and its correction are both in one object, and the trajectory remains reconstructable
from that object alone.

**Reopening returns to `acknowledged`, never further along.** If an obligation was resolved on
evidence that proved wrong, the completion is in doubt too, so the way back runs through scheduling
and fresh evidence like any other. There is still no route to `resolved` that skips evidence.

**Reopening a `superseded` obligation is permitted**, since supersession can be recorded in error
like anything else. If the obligation that superseded it is still open, the result is two open
obligations sharing an `identity_key`, and section 6 rule 3 governs: flag for human
disambiguation, never merge automatically.

**Reopening must be reported.** A rising reopen rate means closures are being recorded carelessly,
which is worth seeing early rather than discovering during an incident. Implementations report it
over all obligations, including those reopened and later closed properly, because the first closure
was still wrong.

The alternative design, where a terminal state is final and a mistake produces a fresh obligation
linked to the old one, was considered and rejected. It leaves the mistaken obligation counted as
closed forever, which inflates the one metric this specification exists to make honest, and it
splits the truth about a finding across two records at the moment somebody most needs it in one
place. See section 12.1 B.

**From `created` to `acknowledged`** requires verification of the extracted fields (R7, C3). An
obligation may sit in `created` indefinitely. It still generates reminders, but the prepared summary
is marked as unverified.

---

## 4. Closure

### 4.1 Evidence types

An obligation may only enter `completed` with a `closure.evidence` of one of the following types.

| Type | Meaning | Source |
|---|---|---|
| `matching_study` | A subsequent study of the recommended modality covering the finding's anatomy exists after `document_date` | FHIR feed, patient upload, institution registry |
| `matching_result` | A subsequent laboratory result of the recommended type exists | as above |
| `treatment_started` | Documented initiation of the recommended treatment | programme record, patient upload, attestation |
| `clinician_attestation` | A named clinician recorded that the action was performed | signed entry |
| `patient_attestation` | The patient states the action was performed | lowest tier, flagged as such |

`patient_attestation` is accepted because in most of the world it is the only obtainable evidence.
It is recorded at a distinct confidence tier, and must be visually distinguished in any audit view.

### 4.2 Prohibited closures

- Elapsed time (R2).
- A reminder being delivered, opened, or read.
- The patient dismissing a notification.
- Absence of contradicting information.

### 4.3 A cleared closure is not a deleted one

Reopening under section 3.1 sets `closure` to null on the current view. The closure that was
recorded stays in `history`, with the actor who recorded it and the timestamp, exactly as written.
It is never edited and never removed.

An implementation that deletes the closure record on reopen fails section 11.6, because the
trajectory can then no longer show that the obligation was once closed, by whom, and on what
grounds. The whole value of allowing correction is that the error remains visible afterwards.

### 4.4 `lost_to_followup` is not a success state

It terminates the escalation ladder. It does not discharge the obligation. It must be reported
separately in every metric, and never aggregated into "closed". A system that quietly folds
`lost_to_followup` into its closure rate has recreated the problem it was built to solve.

---

## 5. History

Append-only. Every entry takes this form.

```jsonc
{
  "at": "2026-03-20T10:04:00Z",
  "actor": { "kind": "patient|clinician|coordinator|system", "ref": "opaque-id" },
  "event": "created|verified|corrected|owner_transferred|reminded|escalated|
            scheduled|evidence_added|state_changed|reopened",
  "from_state": "acknowledged",          // where applicable
  "to_state": "scheduled",
  "detail": { }                          // event-specific, no free-text PHI
}
```

The requirement is that any obligation's full trajectory must be reconstructable from `history`
alone: what was extracted, at what confidence, from which document, who was notified and when, by
what channel, what evidence closed it, and who recorded that evidence. If a trajectory cannot be
reconstructed, the deployment is non-compliant with this specification.

---

## 6. Finding identity across studies

This is the hardest component. The same nodule appearing in six serial CT studies must produce one
obligation with an evolving history, rather than six competing obligations.

**`identity_key`** is derived from a stable tuple:

```
sha256( subject_ref | finding.category | anatomy_normalised | laterality )
```

Measurement is deliberately excluded, since the whole point is that the finding changes size.

Resolution rules:

1. A new obligation whose `identity_key` matches an open obligation supersedes it. The older moves
   to `superseded`, and the newer inherits the older's `history` by reference.
2. Supersession is only permitted where the new `document_date` is later than the old one.
3. Where `anatomy` is absent or too coarse to distinguish, for example "nodule in the lung" with no
   lobe specified, the obligations are not merged automatically. They are flagged for human
   disambiguation. Merging on weak evidence is more dangerous than a duplicate, because it can
   silently discharge a real obligation.
4. A finding whose `location` is `nearest_sentence` does not take part in automatic supersession
   until a person has confirmed it, in either direction: it neither supersedes an existing
   obligation nor is superseded by an incoming one. The quote was chosen by a machine and may be the
   wrong sentence, and a wrong finding produces a wrong identity key, which is the silent merge rule 3
   exists to prevent.
5. **Obligations with no finding.** Where `finding.absence` is set there is no finding category to
   key on, so the tuple uses the recommendation instead:

   ```
   sha256( subject_ref | "none" | recommendation.action | modality_normalised
           | anatomy_normalised | laterality )
   ```

   Without this, every findingless obligation held by one person would share a key and the first
   would be superseded by the next, whatever each asked for. Rule 3 applies unchanged, so a
   findingless obligation with no anatomy is never merged automatically. That is deliberate: two
   annual screening recommendations a year apart should usually supersede one another, and a person
   confirming that costs less than a rule that occasionally merges two different duties.

---

## 7. Controlled vocabularies

`finding.category` is a closed, versioned list. The v0.2 scope is as follows.

**Radiology:** `pulmonary_nodule`, `hepatic_lesion`, `renal_mass`, `adrenal_nodule`,
`thyroid_nodule`, `pancreatic_cyst`, `adnexal_mass`, `aortic_aneurysm`, `vertebral_fracture`,
`coronary_calcium`

**Laboratory:** `iron_deficiency_anaemia`, `haematuria_microscopic`, `psa_elevated`,
`thrombocytosis`, `hypercalcaemia`, `lft_abnormal_persistent`

**Screening:** `fit_positive`, `mammography_recall`, `cervical_screen_abnormal`,
`aaa_screen_positive`

**Infectious disease:** `tb_confirmed`, `tb_presumptive`, `hbv_chronic`, `hcv_positive`,
`hiv_positive`, `syphilis_positive`

**Surveillance:** `hcc_surveillance`, `lynch_surveillance`, `barretts_surveillance`,
`post_treatment_surveillance`

Unrecognised findings map to `other`, with `text_verbatim` preserved. Obligations of category
`other` are tracked and reminded, but generate no guideline-derived interval. The interval must come
verbatim from the report, or be absent.

**`none`** is reserved for obligations with no finding, and is valid only when `finding.absence` is
set. It is distinct from `other`: `other` says a finding exists and falls outside the list, `none`
says there is no finding to categorise. Folding the two together would make a benign screening
return indistinguishable from an unusual lesion.

---

## 8. Escalation ladder

| Level | Trigger | Action | Target |
|---|---|---|---|
| L0 | Obligation created | Confirmation and prepared summary issued | Patient |
| L1 | 30 days before `due_date` | Reminder, prepared summary re-issued | Owner |
| L2 | `due_date` reached | Reminder, ownership confirmation requested | Owner and registered clinician |
| L3 | `due_date` plus 30 days | Escalation, appears on coordinator worklist (institutional deployments) | Coordinator |
| L4 | `due_date` plus 90 days | Final escalation. On exhaustion, a named actor records `lost_to_followup` | Service lead |

Intervals are configurable per locale pack. The ladder structure is not.

**No rung moves an obligation by itself.** The ladder reports which rung an obligation is on and
who should act. Exhausting it at L4 does not transition anything: a named actor records
`lost_to_followup`, and the history then says who accepted that outcome. R1 admits no implicit
transitions, and an obligation drifting into a terminal state unattended is the failure this
specification exists to prevent, wearing a different name. Corrected in v0.3; see section 12.1 C.

**Channel policy.** SMS is a first-class channel rather than a fallback. It is the only channel
reliably present six months later, after an app has been uninstalled or a phone replaced. Push and
email are supplementary. Message content at every level is non-interpretive (C1) and never implies
an all-clear (C2).

**Anti-fatigue rule.** In institutional deployments, the primary output is a worklist owned by a
named coordinator, not broadcast alerts to clinicians. Systems that invert this are ignored within
weeks. It is the most consistently reported cause of failure in deployed tracking programmes.

---

## 9. Prepared summary

A generated, translated, printable and shareable one-page document. It is the single feature that
converts knowing into done.

Required contents:

1. The finding, quoted verbatim from the patient's own report. Where `finding.absence` is set, a
   plain statement instead that the report names no specific finding for this follow-up, or that one
   could not be identified and the report should be checked. Never a description of the finding in
   other words.
2. The recommendation, quoted verbatim.
3. The source: document date and locator.
4. The due date, and how many days overdue if applicable.
5. The guideline reference and version, where one applies.
6. The specific request, phrased as an ask: *"I am asking whether this follow-up has been
   arranged."*
7. A verification status line: whether the extraction was patient-confirmed, and whether extraction
   is validated for this language.

Prohibited contents: any statement of what the finding might mean, any risk estimate, and any
urgency language not present in the source report.

---

## 10. Locale packs

```jsonc
{
  "locale": "en-NG",
  "version": "0.3.0",
  "language": "en",
  "extraction_validated": false,
  "guideline_overrides": { "pulmonary_nodule": "bts_2015" },
  "date_format": "DD/MM/YYYY",
  "escalation_intervals": { "L1": -30, "L2": 0, "L3": 30, "L4": 90 },
  "channels": ["sms", "push"],
  "copy": { /* every user-facing string, including all safety copy */ },
  "signposting": { "tb_confirmed": "Nearest DOTS centre, see national TB programme directory" }
}
```

**Graceful degradation is mandatory.** With no matching pack, the system falls back to the nearest
language, marks `extraction_validated` as false, omits signposting, and continues to provide
extraction, verification, tracking, reminders and the prepared summary. No user is ever blocked
pending support for their country.

---

## 11. Conformance

An implementation conforms to this specification if all of the following hold.

1. No obligation reaches a terminal state without a `closure.evidence` of a declared type, or an
   explicit documented terminal reason.
2. No transition occurs without a `history` entry bearing an actor and a timestamp.
3. `lost_to_followup` is reported separately from closures in every metric surfaced to any user.
4. Every user-facing string is non-interpretive, and no output asserts an all-clear.
5. Extraction confidence and language-validation status are surfaced rather than hidden.
6. A full trajectory is reconstructable from `history` alone.
7. The system operates without retaining source documents.
8. A finding located by nearest match is shown to the person verifying the obligation as located by
   nearest match, with its score, and is never presented as an exact quote. It takes no part in
   automatic supersession until confirmed (section 6 rule 4).
9. No finding text is ever produced that is not a verbatim span of the source. An obligation whose
   finding cannot be located carries `absence: not_located` rather than a paraphrase.

---

## 12. Open questions

### 12.1 Contradictions found by implementing this specification

Four places where v0.2 disagreed with itself, found by writing the reference implementation against
it in August 2026. Three were corrected in v0.3 and the fourth in v0.4. A fifth, E, is of a
different kind: it was found by measuring the extraction layer on real reports, not by implementing
the text, and it was corrected in v0.5. All five are now settled.

They are recorded rather than quietly fixed because an independent implementer meets the same
places, and a specification that silently changes underneath its readers is worse than one that
shows its working.

**A. `not_indicated` was drawn both as an edge and as a state. RESOLVED in v0.3.** The section 3
diagram showed an arrow into `resolved` labelled `not_indicated`, and also listed `not_indicated`
among the terminal exits.

Resolved in favour of the terminal state, and the arrow is gone. The sentence below the diagram was
already the tiebreaker: no edge reaches `resolved` without passing through recorded evidence. It is
still counted as a closure, so no metric changes, and keeping it distinct preserves the record of
why an obligation closed rather than flattening every ending into one state.

**D. Terminal exits were drawn from one state and needed from all of them. RESOLVED in v0.3.** The
v0.2 diagram drew the exit line beside `acknowledged`, which read as though only an acknowledged
obligation could be declined or superseded. The reference implementation allowed the exits from
every non-terminal state, because the alternative strands obligations: a patient may decline before
verifying, a finding may be superseded while its obligation is still in `created`, and a patient may
die at any point.

Section 3 now says this in words rather than leaving it to where a line was drawn.

**C. L4 asked elapsed time to make a state change, which R1 forbids. RESOLVED in v0.3.** Section 8
said of L4: on exhaustion, becomes `lost_to_followup`. Read plainly that is a transition caused by
the passage of time. R1 admits no implicit transitions.

The wording now says a named actor records it. The history then shows who accepted that outcome,
which is the point of keeping one. The alternative would make the system's worst outcome the only
thing that happens without anyone deciding it.

**B. `reopened` had no edge. RESOLVED in v0.4: the edge is added.** Section 5 listed `reopened` in
the history event vocabulary while section 3 drew no reopen transition. Unlike the others this was
not a drafting slip, but a real unanswered question: what the system does when a person gets a
terminal decision wrong, which is not rare.

Two designs were considered. Add a reopen edge, or keep terminal states final and have a mistake
produce a fresh obligation linked to the old one. Section 3.1 has the resolution and its
conditions. The reasoning for choosing it is recorded here, because a reader who disagrees should
be able to see what was weighed.

**Against the linked-successor design, decisively:** it leaves the mistaken obligation terminal
forever, so it counts as closed in every metric. The closure rate is then inflated by exactly the
errors most worth seeing, and anyone asking whether a finding was discharged finds a closure and
stops. Section 4.3 already treats folding `lost_to_followup` into "closed" as recreating the
problem this specification exists to solve. Permanently counting mistaken closures as closures does
the same thing by another route.

**Three further reasons specific to this specification.** Section 11.6 requires a full trajectory
to be reconstructable from `history` alone; with a linked successor the trajectory of the duty is
not in any one object. The prepared summary in section 9 renders a single obligation, so a truth
split across two records has no correct rendering. And the object is patient-held and portable: a
person carrying two records about the same finding, one closed and one open, is a person who will
not know what to do.

**An objection considered and set aside.** A reopen path is in principle a path to undo an
inconvenient closure. It does not work as an incentive here, because reopening moves an obligation
out of the closed column and back into the open one, making the closure rate worse. Nobody games a
metric in the direction that makes them look worse. The reporting requirement in section 3.1 covers
the residual case where reopening is happening too often for a different reason.

**One cost accepted.** The current view of an obligation can now say `acknowledged` where it once
said `resolved`. Systems that cached the earlier answer will be stale. This is the ordinary cost of
a state machine that admits correction, and it is preferable to a registry that cannot be corrected
at all.

**E. R5 refused real obligations with no finding to quote. RESOLVED in v0.5.** v0.4 required every
obligation to carry `finding.text_verbatim`, on the reasoning that an obligation with no quoted
source is a paraphrase of one. The reasoning holds. The requirement did not, because it was found to
reject two kinds of real duty when the extraction layer was measured on 500 hand-labelled
MIMIC-IV-Note radiology reports in September and October 2026.

The first kind names no finding at all. Of 130 labelled follow-up recommendations, 14 had nothing to
quote: five were routine mammography rounds after a benign result, eight were requests for further
imaging after a normal study if symptoms persisted. Each is a real duty and the annual screening
return is among the ones people most often lose. v0.4 could hold none of them.

The second kind names a finding the extractor could not quote exactly. On the held-out test split,
five candidates were discarded because the model's finding quote could not be located in the
source, and four of the five carried correctly located recommendations. A rule written to stop a
fabricated quote was discarding real recommendations along with it.

Three designs were weighed for the first kind. **Quoting a negative statement as the finding**, for
example "No specific evidence of malignancy", satisfies R5 literally and was rejected, because an
identity key built from it means nothing and the prepared summary would present a reassurance as
though it were an abnormality. **Declaring findingless obligations out of scope** was rejected
because it drops a tenth of the real duties in the corpus, including the screening returns. **An
absent finding with a stated reason** was adopted. R5 now reads that a field may be absent and may
never be invented, which is what it always meant.

For the second kind, keeping the recommendation with the finding absent was the conservative choice
and is what `not_located` provides. A better one is usually available: the model's quote is most
often a near miss, a word changed or a phrase tidied, and the closest sentence in the source is the
right one. Eight development and test candidates were rejected this way, and seven of them had a
labelled finding. In five of the seven the nearest source sentence was the labelled finding. In one
the model had quoted the recommendation itself as the finding, which the field notes now exclude. In
the last the nearest sentence was wrong, at a match score indistinguishable from the correct ones,
and no threshold would have separated it. So `nearest_sentence` is permitted, never as an exact
quote, never driving supersession until a person confirms it, and never as the recommendation's own
sentence. Eight cases establish that the approach recovers real findings. They do not establish a
threshold, and an implementation should treat its threshold as provisional.

**Found while writing this.** Section 6 has keyed identity on `laterality` since v0.2, and the
object in section 2 never defined the field. v0.5 adds it to `finding`, with the four values the
extraction layer already uses.

### 12.2 Design questions still open

- Mapping to FHIR `Task`, `ServiceRequest`, or a custom profile. The fit is imperfect in all three,
  because FHIR models requests and records rather than owed duties.
- Multi-party ownership, where a patient and a coordinator both legitimately hold an obligation.
- Cryptographic portability: should obligations be individually signed, so that they remain
  verifiable after leaving any given deployment?
- Merge semantics when a patient holds obligations from two institutions describing the same finding
  with different `identity_key` components.
- Whether `patient_attestation` should be permitted to close obligations in domain D (infectious
  disease), where the mortality consequence of a false closure is highest.
