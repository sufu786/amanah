# Portable Clinical Obligation, specification v0.2

**Status:** draft for public comment
**Licence:** CC BY 4.0
**Date:** 2026-07-30
**Concept DOI:** [10.5281/zenodo.21706768](https://doi.org/10.5281/zenodo.21706768)

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
| R5 | **Verbatim source is retained in the object**, never paraphrased. | Non-interpretive guarantee, patient verification, auditability. |
| R6 | **Every recommendation traces to a guideline rule and version.** | Explains why, and allows retrospective correction when guidance changes. |
| R7 | **Confidence is a first-class field, never hidden.** | Below-threshold extraction must be visibly unverified. |
| R8 | **The object is complete without the source document.** | Enables zero retention (constraint C5). |

---

## 2. The object

```jsonc
{
  "schema": "cor.obligation/0.2",
  "id": "uuid-v4",                       // stable, client-generated
  "subject_ref": "opaque-local-id",      // never a national or medical identifier

  "finding": {
    "text_verbatim": "8 mm nodule in the right upper lobe",
    "category": "pulmonary_nodule",      // controlled vocabulary, see section 7
    "anatomy": "lung.right.upper_lobe",  // optional
    "measurement": { "value": 8, "unit": "mm" },   // optional
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
- **`patient_corrections`** is the highest-value training signal the system generates. It should be
  retained at field level, de-identified, even under zero retention of source documents.

---

## 3. State machine

```
                      +---------------+
                      |    created    |   extraction complete, not yet confirmed
                      +-------+-------+
                              |  verify (patient or clinician confirms fields)
                      +-------v-------+
          +-----------| acknowledged  |-----------+
          |           +-------+-------+           |
          |                   |  schedule         |
          |           +-------v-------+           |
          |           |   scheduled   |           |
          |           +-------+-------+           |
          |                   |  evidence of completion
          |           +-------v-------+           |
          |           |   completed   |           |
          |           +-------+-------+           |
          |                   |  outcome recorded |
          |           +-------v-------+           |
          |           |   resolved    |<----------+
          |           +---------------+   not_indicated
          |
          |  terminal exits, each requiring a reason and an actor
          +--> declined           patient declined, documented
          +--> not_indicated      clinician documented follow-up unnecessary
          +--> superseded         replaced by a later obligation on the same finding (section 6)
          +--> lost_to_followup   escalation ladder exhausted; NOT a closure (section 4.3)
          +--> deceased
```

**Permitted transitions only.** Any transition not drawn above is rejected. In particular there is
no edge from any state to `resolved` that does not pass through recorded evidence.

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

### 4.3 `lost_to_followup` is not a success state

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

---

## 8. Escalation ladder

| Level | Trigger | Action | Target |
|---|---|---|---|
| L0 | Obligation created | Confirmation and prepared summary issued | Patient |
| L1 | 30 days before `due_date` | Reminder, prepared summary re-issued | Owner |
| L2 | `due_date` reached | Reminder, ownership confirmation requested | Owner and registered clinician |
| L3 | `due_date` plus 30 days | Escalation, appears on coordinator worklist (institutional deployments) | Coordinator |
| L4 | `due_date` plus 90 days | Final escalation; on exhaustion, becomes `lost_to_followup` | Service lead |

Intervals are configurable per locale pack. The ladder structure is not.

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

1. The finding, quoted verbatim from the patient's own report.
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

---

## 12. Open questions

- Mapping to FHIR `Task`, `ServiceRequest`, or a custom profile. The fit is imperfect in all three,
  because FHIR models requests and records rather than owed duties.
- Multi-party ownership, where a patient and a coordinator both legitimately hold an obligation.
- Cryptographic portability: should obligations be individually signed, so that they remain
  verifiable after leaving any given deployment?
- Merge semantics when a patient holds obligations from two institutions describing the same finding
  with different `identity_key` components.
- Whether `patient_attestation` should be permitted to close obligations in domain D (infectious
  disease), where the mortality consequence of a false closure is highest.
