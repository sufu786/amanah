# Amanah

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.21706768.svg)](https://doi.org/10.5281/zenodo.21706768)

**Nothing found should be lost.**

*Amanah* (Arabic أمانة) means a trust: something entrusted to your keeping that you are duty-bound
to discharge and return.

Amanah is a free, open-source registry for **portable clinical obligations**. These are
patient-held records of a follow-up that a clinician recommended, tracked until evidence shows it
actually happened.

It detects no disease. It carries detections that have already been made through to the treatment
that should have followed.

---

## The problem

The people this is built for are not those whose disease was missed. They are those whose disease
was found, written down, and then lost.

- **28-77%** is the reported completion rate for recommended follow-up on actionable incidental
  radiology findings. One analysis found 39.1% overall adherence.
- **13-20%** of people with bacteriologically confirmed tuberculosis never start treatment in
  high-burden settings. In one cohort, 17.1% of them died, and 69.7% of those deaths occurred
  within 30 days of diagnosis.
- **3% rising to 14.6%** is the proportion of the world's roughly 254 million people with chronic
  hepatitis B receiving treatment (2022 to 2024), against a WHO 2030 target of 80%.
- **97.7% versus 49.3%** is hepatitis B treatment initiation among eligible patients with active
  linkage, compared with routine primary care.

Detection succeeded in every one of those cases. Linkage failed. Linkage is a software problem.

The full evidence base and citations are in [`CONCEPT_NOTE.md`](CONCEPT_NOTE.md).

## What exists already, and what does not

Institution-side follow-up tracking is mature and commercial. LLM extraction of follow-up
recommendations from reports is published research. Patient-side record aggregation exists and is
open source.

No system anywhere is simultaneously all six of the following.

| | Property |
|---|---|
| 1 | **Patient-held.** The obligation survives a change of institution, country or insurer. |
| 2 | **Condition-agnostic.** Radiology, labs, screening and infectious disease in one ledger. |
| 3 | **Source-agnostic.** A photograph of a paper report is enough. No integration required. |
| 4 | **Global.** Multilingual, degrading gracefully where no locale support exists. |
| 5 | **Free and open source.** |
| 6 | **Non-interpretive by design.** Makes no diagnostic claim, so it is not a medical device. |

Properties 1, 3 and 6 taken together are what remove the integration, procurement and regulatory
gates that confine every mature implementation to wealthy health systems.

## The primitive

Health data standards model *records*. None of them models an outstanding duty owed to a patient.

```
Obligation := {
  finding            what was found, verbatim from the source document
  recommended_action what was recommended, verbatim
  due_date           derived from the stated interval and the source date
  source_evidence    the document, page, and quoted sentence
  closure_evidence   what would prove this is discharged, and what actually did
  owner              exactly one accountable party at any time
  state              explicit, with no implicit or time-based transitions
}
```

The specification is in [`OBLIGATION_SPEC.md`](OBLIGATION_SPEC.md).

## Safety constraints

These are load-bearing.

- **Never interpret.** *"Your report recommends a follow-up scan"*, never what it might mean.
- **Never imply an all-clear.** No extraction result is ever reported as reassurance.
- **The patient validates.** Extracted fields are shown beside the highlighted source sentence for
  confirmation. This is what makes operation safe in languages with no validated extraction.
- **Closure requires evidence.** Elapsed time never closes an obligation. That is the failure being
  fixed.
- **`lost_to_followup` is never counted as a closure.**
- **Minimal retention.** Process, emit the obligation, discard the source document.

## Status

Specification published. Extraction work under way. **No part of the registry itself is built**:
there is no obligation object, no state machine, no closure path and no reminders. Nothing here is
fit for clinical use by anyone.

| Phase | Deliverable | Status |
|---|---|---|
| 0 | Specification, public repository, DOI | Complete |
| 1 | Extractor validated on a public corpus | Under way, see below |
| 2 | Upload-a-report path, patient verification, reminders, prepared summary | Not started |
| 3 | Locale packs | Not started |
| 4 | Patient FHIR connect (US Cures Act APIs, NHS App) | Not started |
| 5 | TB and hepatitis B linkage deployment with a national programme partner | Not started |
| 6 | Institution-side registry deployment | Not started |

### Phase 1 in detail

Built: an output schema, a versioned prompt, a runner that rejects any quote it cannot locate
character-for-character in the source document, a ten-case smoke suite, and a gold-standard
labelling protocol written before any model was run. A 50-report pilot on the Open-i chest X-ray
collection selected `qwen2.5:7b`, on zero false positives and zero fabrications. See
[`extraction/RESULTS.md`](extraction/RESULTS.md).

Not done, which is why this phase is nowhere near complete: **no corpus has been labelled.** The
pilot corpus turned out to contain no follow-up recommendations at all, so recall, interval accuracy
and category accuracy are entirely unmeasured, and three known extraction defects are documented and
unfixed. *Validated* in the phase title means measured against hand labels under
[`extraction/LABELLING.md`](extraction/LABELLING.md). That has not happened, and no number published
so far should be read as though it had.

## Licensing

- Reference implementation: **AGPL-3.0**. Modified versions offered as a network service must
  publish source. This was chosen deliberately over a permissive licence, because the goal is
  preventing enclosure.
- Specification and documents: **CC BY 4.0**.
- The specification is vendor-neutral by design. Anyone may implement it without adopting the
  Amanah name.
- The **name** is governed separately: see [`TRADEMARK.md`](TRADEMARK.md). Fork the code freely and
  rename; implement the specification freely and call it whatever you like.

## Citation

See [`CITATION.cff`](CITATION.cff).

> Dedrani Mohamedsarfaraz Mohamadfiroz (2026). *The Portable Clinical Obligation: a patient-held,
> condition-agnostic registry for closing diagnostic follow-up loops worldwide.* Zenodo.
> https://doi.org/10.5281/zenodo.21706768

Two DOIs exist, for two different things:

| What | DOI | Cite when |
|---|---|---|
| **Paper** (concept note and specification) | [10.5281/zenodo.21706768](https://doi.org/10.5281/zenodo.21706768) | You are citing the ideas. **This is usually the one you want.** |
| **Software** (tagged releases of this repository) | [10.5281/zenodo.21708214](https://doi.org/10.5281/zenodo.21708214) | You specifically mean the code. |

Both are concept DOIs and always resolve to the latest version.

## Contributing

The most valuable contributions are **locale packs**: language, guideline variants, and
health-system signposting for your country. See section 10 of the specification.

---

*This repository is a design disclosure, published to establish prior art and to prevent enclosure
of the described system by patent. It describes intended architecture, together with early
extraction code and pilot measurements on public research data, and is not a report of clinical
results. No claim of clinical efficacy is made.*
