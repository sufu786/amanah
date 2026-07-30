# The Portable Clinical Obligation: a patient-held, condition-agnostic registry for closing diagnostic follow-up loops worldwide

**Concept note, version 1.1**

- **Author:** Dedrani Mohamedsarfaraz Mohamadfiroz, Independent Researcher
- **ORCID:** [0009-0004-7645-7151](https://orcid.org/0009-0004-7645-7151)
- **Contact:** s.dedrani786@gmail.com
- **Date:** 2026-07-30
- **DOI (concept):** [10.5281/zenodo.21706768](https://doi.org/10.5281/zenodo.21706768)
- **Document licence:** CC BY 4.0
- **Reference implementation licence (intended):** AGPL-3.0
- **Reference implementation:** **Amanah**. From the Arabic *أمانة*: a trust, something entrusted to
  your keeping that you are duty-bound to discharge and return. The word is natively understood
  across Arabic, Urdu, Swahili, Malay/Indonesian, Persian, Hausa and Turkish (*emanet*), which is
  substantially the same map as the global tuberculosis and hepatitis B burden.
- **Status:** Defensive publication and design disclosure. Not a clinical study.

---

## Abstract

Across every health system studied, a substantial fraction of correctly-made diagnoses and
correctly-written follow-up recommendations are never acted on. The detection succeeded; the
linkage failed. Reported failure rates range from roughly a quarter to a half of actionable
incidental radiology findings in high-income settings, through to 13-20% of bacteriologically
confirmed tuberculosis diagnoses that never reach treatment initiation in high-burden countries. In
one such cohort, 17% of the patients lost at that step died, most of them within 30 days.

Existing solutions to this problem are institution-side, commercial, single-modality,
single-country, and priced. They protect patients only for as long as those patients remain inside
one organisation.

This note specifies a different primitive. A **portable clinical obligation** is a patient-owned,
institution-independent, condition-agnostic record of the form `{finding, recommended action, due
date, source evidence, closure evidence}`. Around it sits a free, open-source registry that creates,
tracks, escalates and closes such obligations from any source, including a photograph of a paper
report, in any country, without institutional integration and without making any diagnostic claim.

The system detects no disease. It carries detections that have already been made through to the
treatment that should have followed.

---

## 1. Problem statement

A clinician writes: *"8 mm right upper lobe nodule, recommend CT follow-up in 6 months."*
A laboratory reports iron-deficiency anaemia in a 68-year-old. A sputum sample returns positive for
*M. tuberculosis*. A cervical screen returns HPV-positive.

In each case the diagnostic act succeeded. In a large and measurable fraction of cases, nothing
subsequently happens. The patient is discharged, the ordering clinician was treating something else,
the record moves institution, the result arrives in an inbox that nobody owns. The obligation exists
in prose inside a document and in no system that tracks it to completion.

The people harmed here are not those whose disease was missed. They are those whose disease was
found, written down, and then lost.

Three structural causes recur across settings:

1. **No owner.** The obligation is created by one clinician and inherited by nobody.
2. **No portability.** Where tracking exists, it is bound to one institution's record system and
   ends at that institution's boundary.
3. **No closure evidence.** Systems mark obligations as handled when a notification is *sent* or a
   date *passes*, rather than when the follow-up demonstrably *occurred*.

## 2. Evidence base

### 2.1 Actionable incidental radiology findings

Completion of recommended follow-up imaging is reported at between roughly 28% and 77% across
studies. One analysis found overall adherence to recommendations for additional imaging of 39.1%,
rising to 56.8% where the patient had a primary care provider within the same institution. Adherence
therefore tracks institutional continuity rather than clinical need [3].

The FIND programme, a structured reporting and tracking system, raised completion from 30.8%
(16 of 52) to 50.7% (34 of 67), p = 0.03 [1]. This is simultaneously proof that structured tracking
works and proof that a good institutional implementation still leaves roughly half of all
obligations unclosed.

### 2.2 Tuberculosis, the highest-mortality linkage gap identified

Pre-treatment loss to follow-up (PTLFU), meaning patients diagnosed but never registered for
treatment, is reported at 4-38%, with pooled estimates of 18% in Africa and 13% in Asia [10]. A
South African cohort measured initial loss to follow-up at 20.0% (2,742 of 13,736). Of those,
17.1% (468 of 2,742) died, and 69.7% of those deaths occurred within 30 days of diagnosis [9].

WHO estimated that only 61% of people who developed TB in 2021 were captured in a treatment
registration system at all [10].

Tuberculosis is curable and, in most high-burden countries, treated free of charge through national
programmes. These deaths are not a treatment-access problem. They are a linkage problem.

### 2.3 Hepatitis B, the largest absolute gap

Of approximately 254 million people with chronic hepatitis B, as of 2022 only 13% were diagnosed and
3% treated. Figures for 2024 improve this to 26.1% diagnosed and 14.6% treated, against WHO 2030
targets of 90% diagnosed and 80% treated [11][12].

The decisive finding is this. Among patients assessed as treatment-eligible, antiviral therapy was
initiated in 49.3% of cases in primary care, 78.1% in hospital specialist care, and 97.7% in
community screening programmes that actively linked individuals to specialist care [11].

Active linkage very nearly eliminates the gap. Linkage, rather than detection or treatment
availability, is the operative variable.

### 2.4 Cervical screening

Attendance at follow-up after a positive or abnormal screen varied from 100.0% in Benin to 72.6% in
Cameroon and 49.2% in Colombia [13]. The same test and the same disease produce radically different
closure rates, as a function purely of follow-up systems.

### 2.5 Laboratory results

Systematic review evidence documents widespread failure to follow up test results for ambulatory
patients, and finds that communicating abnormal results to the responsible clinician is *not
sufficient* to achieve follow-up. Team-based or technological results management is required
[4][14].

### 2.6 Synthesis

The pattern is invariant across income level, disease, and modality. Where an obligation has a named
owner, a due date, active linkage and verified closure, it closes. Where it lives only as prose
inside a document, it does not.

## 3. Prior art

This section is deliberately complete. The contribution claimed in §5 is narrow and is stated
relative to what follows.

**Institution-side commercial systems (mature).** Nuance mPower Clinical Analytics and PowerScribe
Follow-up Manager extract follow-up recommendations from radiology reports using NLP, and manage
them to closure on an auditable tracking board [5][6]. This is the market-leading implementation and
it works. It is proprietary, priced, radiology-only, institution-bound, and deployed principally in
high-income health systems.

**Institution-side academic programmes.** The FIND programme [1] and comparable nurse-navigator
tracking programmes at individual health systems. These are effective, local, not portable, and not
free.

**Acute AI triage.** Aidoc, Viz.ai and similar products address time-critical findings on a
minutes-to-hours horizon. That is a different problem from months-horizon follow-up obligations.

**Extraction research (current).** Several 2025 evaluations of LLM-based and supervised
identification of follow-up recommendations and incidentalomas in radiology reports [7][8]. The
extraction method underlying this proposal is therefore established in the literature, and is not
claimed as novel here.

**A need named but unfilled.** The American College of Radiology publishes both *"Triaged
patient-friendly radiology report follow-up recommendations"* and *"Ensure patient follow-up of
radiology report recommendations"* as defined AI use cases [15]. The field has formally articulated
this need without filling it.

**Patient-side record aggregation.** Fasten Health (MIT-licensed, self-hosted, SMART-on-FHIR
aggregation across large numbers of providers) is the closest existing open-source system [16].
Apple Health Records and Android Common Health perform comparable aggregation. All of these
aggregate *records*. None of them create, own, track, escalate or close *obligations*.

**Global health programme management.** DHIS2 Tracker, OpenMRS and CommCare support TB and HIV
programme management at national scale, open-source and free. All three are provider-side,
institution-bound, and disease-programme-specific. The patient does not hold the obligation.

## 4. The gap

No system identified in this review is simultaneously all six of the following.

| # | Property | Nuance | FIND | Fasten | DHIS2/OpenMRS |
|---|---|---|---|---|---|
| 1 | **Patient-held.** Obligation survives change of institution, country, insurer | No | No | Yes | No |
| 2 | **Condition-agnostic.** Radiology, labs, screening, infectious disease in one ledger | No | No | Partial | No |
| 3 | **Source-agnostic.** A photograph of a paper report suffices; no integration required | No | No | No | No |
| 4 | **Global.** Multilingual, degrading gracefully with no locale support | No | No | No | Yes |
| 5 | **Free and open source** | No | No | Yes | Yes |
| 6 | **Non-interpretive by design.** Makes no diagnostic claim, hence not a medical device | No | No | Yes | Yes |

Existing systems hold one or two of these properties. None holds all six, and the combination is not
incremental. Properties 1, 3 and 6 taken together are what remove the institutional integration,
procurement and regulatory gates that confine every mature implementation to wealthy health systems.

## 5. Contribution

**The portable clinical obligation.**

Health data standards model *records*: observations, reports, diagnoses, encounters. No widely-used
standard models an **outstanding duty owed to a patient**, meaning a thing that is open, has an
owner, has a due date, and can only be closed by evidence.

This note specifies that object, and a registry built on it:

```
Obligation := {
  finding            what was found, verbatim from the source document
  recommended_action what was recommended, verbatim
  due_date           derived from the stated interval and the source date
  source_evidence    the document, page, and quoted sentence it came from
  closure_evidence   what would prove this is discharged, and what actually did
  owner              exactly one accountable party at any time
  state              explicit, with no implicit or time-based transitions
}
```

Five properties make it novel in combination:

- **Patient-owned and portable.** The obligation travels with the person, not the institution.
- **Condition- and modality-agnostic.** A pulmonary nodule, a positive sputum smear, an HPV-positive
  screen and a raised PSA are the same object with different payloads.
- **Source-agnostic.** Created from a FHIR resource, a PDF, or a photograph of a printed report. The
  paper path requires no partnership with anyone, and is therefore globally available on day one.
- **Closure requires evidence.** No obligation closes because a notification was read or a date
  passed. Time-based auto-closure is structurally prohibited, since it is precisely the failure mode
  being corrected.
- **Non-interpretive.** The system reproduces the clinician's own written recommendation. It never
  asserts what a finding means.

The full data model and state machine are specified in `OBLIGATION_SPEC.md`.

## 6. System design (summary)

1. **Ingest.** FHIR `DiagnosticReport` or HL7 v2 ORU where available; PDF; photograph with OCR.
2. **Extract.** Structured fields from narrative text. This is the single probabilistic component.
   It emits a confidence score.
3. **Patient verification.** The extracted fields are displayed beside the highlighted source
   sentence, and confirmed or corrected by the patient. See §7.
4. **Obligation ledger.** Append-only, with an explicit state machine and a single named owner at
   all times.
5. **Reminder and escalation ladder.** L0 created, L1 approaching, L2 overdue, L3 significantly
   overdue, L4 escalated. Channel-agnostic, with SMS as a first-class path.
6. **Closure.** Only on evidence: a matching subsequent study, a documented clinical decision that
   follow-up is not indicated, or a documented patient refusal.
7. **Prepared summary.** A one-page, translated, printable and shareable document containing the
   finding, the date, the verbatim quote from the patient's own report, the guideline reference and
   the specific request. This converts a vague conversation into a specific and actionable one, and
   is the primary mechanism by which knowing becomes done.

**Architecture.** A universal core (extraction, ledger, state machine, date arithmetic, reminders,
summary) plus versioned, community-contributable *locale packs* (language, guideline variants,
report conventions, health-system signposting, safety copy). Absence of a locale pack degrades
signposting only. Extraction, tracking, reminders and the summary all still function. Nobody is
excluded pending support for their country.

## 7. Safety design constraints

These are load-bearing rather than aspirational. Each addresses a specific way this system could
harm someone.

**C1. Never interpret.** The system states *"your report recommends a follow-up scan"*. It never
states or implies what a finding might mean. Violating this both frightens people wrongly and
converts the system into a regulated medical device in every jurisdiction simultaneously.

**C2. Never imply an all-clear.** Where extraction finds nothing, the output is *"no follow-up
recommendation was found in this document; this does not mean there isn't one"*. A missed extraction
producing false reassurance is the single failure mode by which this system could kill someone, and
it is invisible by construction.

**C3. Patient as validator.** Extracted fields are always shown beside the highlighted source text
for confirmation. This is what makes operation safe in languages with no validated extraction
performance and no labelled corpus: the patient reads their own report in their own language and
confirms it. Where extraction is unvalidated for a language, the interface says so explicitly.

**C4. Permanent audit sampling.** False negatives are invisible. A continuously sampled, manually
reviewed audit stream estimating the miss rate is a permanent operating requirement, not a one-off
validation activity.

**C5. Minimal retention.** Process, emit the obligation, discard the source document by default.
This collapses most of the global compliance surface at once, and it matters acutely in
jurisdictions where a recorded diagnosis carries employment, insurance or social consequences.
On-device processing is the target end state. Design to GDPR and that clears the bar nearly
everywhere.

**C6. Explicit uncertainty.** Confidence is surfaced, never hidden. Below-threshold extractions
enter a review queue, and are never silently accepted or silently dropped.

## 8. Regulatory positioning

A system that surfaces and tracks the clinician's own stated recommendation, and reports whether the
recommended event has occurred, is care coordination and administrative software. It makes no
diagnostic or treatment claim.

A system that asserts *"this finding is suspicious"* is software as a medical device, requiring
separate conformity assessment under EU MDR, FDA, UKCA/MHRA and a long tail of national regimes.

Constraint C1 is therefore not a limitation but the enabling condition for global availability. It
costs nothing clinically, since the interpretation has already been made by a qualified clinician
and is being faithfully reproduced, and it removes 195 separate regulatory conversations.

Deploying organisations retain their own clinical safety obligations, for example DCB0129 and
DCB0160 in the United Kingdom. A clinical safety case and a named clinical safety officer are
required regardless of the software being free.

## 9. Scope of covered obligations

- **A. Actionable incidental radiology findings.** Pulmonary nodule, hepatic lesion, renal mass,
  adrenal nodule, thyroid nodule, pancreatic cyst, adnexal mass, aortic aneurysm, vertebral
  fracture, coronary calcium.
- **B. Abnormal laboratory results requiring workup.** Iron-deficiency anaemia in adults,
  microscopic haematuria, raised PSA, thrombocytosis, hypercalcaemia, persistently abnormal LFTs.
- **C. Screening-programme positives.** FIT-positive, mammography recall, abnormal cervical
  cytology or HPV, AAA screening surveillance.
- **D. Diagnosed but untreated infectious disease.** Tuberculosis, hepatitis B, hepatitis C, HIV,
  syphilis.
- **E. Standing surveillance obligations.** Chronic HBV or cirrhosis requiring 6-monthly HCC
  surveillance, Lynch syndrome, Barrett's oesophagus, post-treatment cancer surveillance.

Prioritisation must follow whether closing the obligation changes the outcome, rather than whether
the signal is easy to extract. Pulmonary nodule leading to lung cancer, AAA leading to rupture,
abnormal cervical screen leading to cervical cancer, and all of domain D, have strong outcome
benefit. Adnexal mass leading to ovarian cancer does not: UKCTOCS demonstrated stage shift without
mortality benefit. That is the most important cautionary result in this field, and it generalises.
Earlier detection helps only where a stage shift changes what treatment can achieve.

## 10. Priority deployment targets

The technical first implementation should be pulmonary nodules, since the Fleischner criteria are
international and unambiguous, and are validatable against public English-language corpora.

The first *mission* deployment should be tuberculosis and hepatitis B linkage to care, for four
reasons:

- the gap is large and measured (§2.2, §2.3);
- mortality following the gap is high and fast, at 17.1% mortality with 69.7% of those deaths
  within 30 days [9];
- active linkage demonstrably closes it, at 97.7% versus 49.3% [11];
- treatment is free at the point of use through national programmes in most high-burden countries.

That final point removes the most serious objection to a patient-facing tracker, which is that
informing someone of an unmet need they cannot afford to meet produces informed helplessness. For
these diseases the treatment is already funded and already available. The missing component is
linkage, which is a software problem, and no free, patient-held, globally available implementation
exists.

## 11. Explicit non-goals

- The system detects no disease. It creates no new diagnostic information whatsoever.
- Anyone never tested, never imaged and never diagnosed is entirely outside its scope.
- It cannot order, schedule, fund or deliver care. The final step requires a clinician.
- It is of limited value where the indicated treatment is genuinely unavailable or unaffordable.
  This is why domain D, with its free national treatment programmes, is the correct primary target,
  and elective oncology workup in uninsured settings is not.

## 12. Validation plan

1. **Extraction performance.** Precision and recall for actionable-finding detection and interval
   extraction on a public English radiology corpus (MIMIC-IV, MIMIC-CXR), against baselines
   published in [7][8]. Hand-labelled evaluation set, with published labels.
2. **Finding-identity resolution.** Accuracy of resolving the same lesion across serial studies.
   This is the hardest technical component, and the one whose failure most rapidly destroys user
   trust through duplicate obligations.
3. **Retrospective closure gap.** Measured rate of recommended follow-ups with no matching
   subsequent study within the same corpus. This single number is simultaneously the validation, the
   baseline and the case for deployment.
4. **Prospective closure rate.** Pre and post closure rate, median time to closure, and
   lost-to-follow-up rate in a defined cohort. The baseline must be measured before deployment.
5. **Permanent miss-rate audit.** Ongoing sampled manual review, per constraint C4.

Retrospective AUC is close to meaningless for screening-adjacent systems. Prospective measurement
against a measured baseline is the only credible evidence.

## 13. Roadmap

| Phase | Deliverable | Gate |
|---|---|---|
| 0 | Obligation object spec, public repo, DOI | none |
| 1 | Extractor validated on public corpus | published metrics |
| 2 | Upload-a-report path (photo, PDF), patient verification, reminders, prepared summary | safety review |
| 3 | Locale pack format, first non-English packs | community |
| 4 | Patient FHIR connect (US Cures Act APIs, NHS App) | per-country |
| 5 | TB and HBV linkage deployment with a national programme partner | programme partnership |
| 6 | Institution-side open-source registry deployment | clinical safety case, IG approval |

Phases 1 to 3 require no partnership with any institution, and are the fastest route to a real
person being helped. Phase 6 has the highest impact per deployment and the longest lead time, since
information governance and procurement cycles are the critical path rather than engineering.

## 14. Governance, licensing and sustainability

- **Reference implementation:** AGPL-3.0. Modified versions offered as a network service must
  publish source. This was chosen deliberately over Apache-2.0, since the objective is preventing
  enclosure rather than maximising enterprise adoption.
- **Specification and this document:** CC BY 4.0.
- **Guideline rule sets:** open data, versioned, so that every generated recommendation is traceable
  to the rule and rule version that produced it.
- **Name and marks:** the reference implementation is named Amanah, and the name should be
  trademarked. Code can always be forked; the name cannot be appropriated. This is the durable
  mechanism for retaining project identity. The *specification* deliberately retains a neutral,
  descriptive name (Portable Clinical Obligation) and a vendor-neutral schema namespace, so that any
  party may implement it without adopting the Amanah mark.
- **Extraction model:** open-weight, capable of running on-premises or on-device. A commercial
  inference API imposes a permanent marginal cost per report and requires data egress, and neither
  is compatible with "free" or with constraint C5.
- **Sustainability:** grant or foundation funding, with an institutional host, established before
  substantial engineering investment. Abandoned safety-critical software is worse than none, because
  it is trusted. The twenty-year survival of DHIS2 under university and grant funding is the model
  to copy.

## 15. Limitations and risks

- **False reassurance** from missed extraction is the principal safety risk. Mitigations are C2, C3
  and C4.
- **Equity inversion.** A patient-facing app preferentially reaches digitally engaged people, who
  are already better served. The institution-side registry (Phase 6) and SMS-first reminder channels
  exist specifically to cover people who will never install anything.
- **Last-mile signposting does not globalise quickly.** The prepared summary is universal, but
  directing someone to where care is actually available is per-country and will lag.
- **Duplicate obligations** arising from unresolved finding identity across serial studies would
  rapidly destroy credibility.
- **Over-following.** Generating follow-up where guidelines indicate none causes radiation, cost,
  procedures and fear. Guideline encoding must be explicit, versioned and auditable.
- **Liability optics.** A registry that documents an obligation which is then not closed creates a
  discoverable record of the gap. This is a genuine adoption barrier for institutions and must be
  addressed directly. The record reduces net exposure, since failure to follow up on documented
  findings is an established malpractice claims category.

---

## References

1. The FIND Program: Improving Follow-up of Incidental Imaging Findings. *J Imaging Inform Med*.
   https://pmc.ncbi.nlm.nih.gov/articles/PMC10287591/
2. Impact of Early Direct Patient Notification on Follow-Up Completion for Nonurgent Actionable
   Incidental Radiologic Findings. https://pubmed.ncbi.nlm.nih.gov/37820835/
3. Factors Affecting Adherence to Recommendations for Additional Imaging of Incidental Findings in
   Radiology Reports. *JACR*. https://www.jacr.org/article/S1546-1440(20)30787-0/abstract
4. Failure to Follow-Up Test Results for Ambulatory Patients: A Systematic Review. *JGIM*.
   https://link.springer.com/article/10.1007/s11606-011-1949-5
5. Nuance PowerScribe Follow-up Manager.
   https://www.nuance.com/healthcare/diagnostics-solutions/workflow-radiology-reporting/powerscribe-follow-up-manager.html
6. Nuance mPower Clinical Analytics.
   https://www.nuance.com/en-gb/healthcare/medical-imaging/mpower-clinical-analytics.html
7. Automated Identification of Incidentalomas Requiring Follow-Up: A Multi-Anatomy Evaluation of
   LLM-Based and Supervised Approaches (2025). https://arxiv.org/pdf/2512.05537
8. Identifying Imaging Follow-Up in Radiology Reports: A Comparative Analysis of Traditional ML and
   LLM Approaches (2025). https://arxiv.org/pdf/2511.11867
9. Early mortality in tuberculosis patients initially lost to follow up following diagnosis,
   Western Cape, South Africa. https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8202951/
10. Reducing Initial Loss to Follow-up Among People With Bacteriologically Confirmed Tuberculosis:
    LINKEDin. https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10787480/
11. Service delivery models and care cascade outcomes for people living with chronic hepatitis B:
    a global systematic review and meta-analysis. https://pubmed.ncbi.nlm.nih.gov/40819651/
12. The hepatitis B care cascade among key populations towards global elimination.
    https://pmc.ncbi.nlm.nih.gov/articles/PMC12874349/
13. Challenges associated with follow-up care after implementation of an HPV screen-and-treat
    program. *BMC Public Health*. https://link.springer.com/article/10.1186/s12889-024-19436-3
14. Notification of abnormal lab test results in an electronic medical record: do any safety
    concerns remain? https://pmc.ncbi.nlm.nih.gov/articles/PMC2878665/
15. ACR AI Use Case: Ensure Patient Follow-Up of Radiology Report Recommendations.
    https://www.acr.org/Data-Science-and-Informatics/AI-in-Your-Practice/AI-Use-Cases/Use-Cases/Ensure-Patient-Follow-Up-of-Radiology-Report-Recommendations
16. Fasten Health, open-source self-hosted personal health record.
    https://github.com/fastenhealth/fasten-onprem

---

*This document is a design disclosure, published to establish prior art and to prevent enclosure of
the described system by patent. It describes intended architecture and is not a report of clinical
results. No claim of clinical efficacy is made.*
