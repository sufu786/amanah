# TRIPOD-LLM checklist for the Phase 1 paper

Where each item of the TRIPOD-LLM reporting guideline (Gallifant et al., Nature Medicine 31, 60-69,
2025) is answered in [`PHASE1_PAPER.md`](PHASE1_PAPER.md). The official checklist is completed at
https://tripod-llm.vercel.app/ and submitted with the paper; this file is the working copy it is
filled from.

**Research design:** LLM evaluation (E), in a healthcare setting (H). No model was developed or
fine-tuned, so items marked for methods (M) or de novo development (D) only are not applicable.

**LLM task:** extraction of follow-up recommendations from radiology reports. The guideline has no
extraction category. Detection, a yes or no per sentence, is treated as classification (C).

No item is open.

| Item | What it asks for | Where, or why not applicable |
|---|---|---|
| 1 | Title names an LLM evaluation, the task, population and outcome | Title |
| 2 | Abstract per TRIPOD-LLM for Abstracts | Structured abstract; checked item by item in the table below |
| 3a | Healthcare context, rationale, existing approaches | Section 1 |
| 3b | Target population, intended use, intended users | Sections 1 and 5 (who sees first-tier and second-tier output) |
| 4 | Objectives, and whether development or validation | Section 1, last two paragraphs; abstract |
| 5a | Data sources for development and evaluation, and why | 2.1, 2.4 |
| 5b | Distribution and description of the data | 2.1, 3.1 |
| 5c | Dates of the oldest and newest text | 2.1 (admissions 2008 to 2019, dates shifted); model training dates per developers, 2.3 |
| 5d | Preprocessing and quality checks | 2.1 (frame exclusions), 2.3 (segmentation and section filter) |
| 5e | Missing and imbalanced data | 2.1 (strata and why B gives no precision), 3.1 (de-identified intervals) |
| 6a | LLM name, version, last training date | 2.3; training dates as reported by the developers [13, 14] |
| 6b | Development process of the LLM | Not applicable (M, D): existing models used as released |
| 6c | Prompting, consistency and inference settings | 2.3 (temperature 0, schema-constrained output, context sizes, no seed, repeat runs identical), 2.4 (ordering effect) |
| 6d | Initial and postprocessed output | 2.3 (yes or no per stage, JSON fields, quote check) |
| 6e | Classification thresholds | 2.3: no probabilities; each stage returns a categorical answer, so there is no threshold |
| 7a | Quality metrics for generative output | Not applicable to this task type; span validity is reported in 3.2 regardless |
| 7b | Relevance of metrics to deployment | 2.5, 3.4 (why location matters), 5 |
| 7c | Outcome definition and how predictions were computed | 2.2 (instance definition), 2.5 (matching and metrics); open model, no inference date needed |
| 7d | Assessors' qualifications and agreement | 2.2, 3.1: one labeller, without clinical or medical training; intra-rater kappa 0.870; no inter-rater figure; limitation stated in 6 |
| 7e | Comparison with other LLMs, humans, benchmarks | 3.5 (7B against 14B), 5 (published work, and why not compared) |
| 8a | How text was labelled, guidelines with examples | 2.2; protocol and precedents in extraction/LABELLING.md |
| 8b | Number of annotators, double annotation, agreement | 2.2, 3.1: one labeller; 100 of 500 relabelled blind; kappa 0.870 intra-rater; no inter-rater figure |
| 8c | Annotator background, and any model used in labelling | 2.2: the labeller has no clinical or medical training; Claude (Anthropic) was consulted on hard calls |
| 9a | Prompt design process | 2.4 |
| 9b | Data used to develop prompts | 2.4 (development split only) |
| 10 | Preprocessing before summarisation | Not applicable (no summarisation) |
| 11 | Instruction tuning or alignment | Not applicable (M, D) |
| 12 | Compute | 2.3 (laptop CPU; 5,399 detection calls in 8.3 hours) |
| 13 | Ethics approval and consent | Ethics |
| 14a | Funding | Funding: none |
| 14b | Conflicts of interest | Competing interests |
| 14c | Protocol | Section 7: CORPUS.md and LABELLING.md served as the protocol |
| 14d | Registration | Section 7: not registered; pre-commitment shown in the repository history |
| 14e | Data availability | Section 7 |
| 14f | Code availability | Section 7 |
| 15 | Patient and public involvement | Patient and public involvement: none |
| 16a | Flow of data through the study | Figure 1, 3.1 |
| 16b | Characteristics per data source and split | 2.1, 3.1, Figure 1 |
| 16c | Clinical variables across development and evaluation | Not applicable: no clinical outcome is predicted |
| 16d | Numbers in each analysis | 3.2, 3.3, 3.5, 3.6 |
| 17 | Performance against prespecified metrics | 3.2 |
| 18 | LLM updating | Not applicable: the model was frozen before the test split; later experiments are in 3.5 and labelled as development |
| 19a | Interpretation, including fairness | 5; fairness is addressed only as a limitation (no subgroup analysis), in 6 |
| 19b | Limitations | 6 |
| 19c | Data challenges: representation, missingness, harmonisation, bias | 3.1 (intervals, categories), 2.6 and 3.6 (modality and region harmonisation), 6 |
| 19d | Intended use, input, end user, autonomy | 3.2, 3.5, 5 ("Failing the rule"): not for unattended use |
| 19e | Handling of poor or missing input | 2.3 (unreadable report is a failure, never a clean result); 3.6 (no due date, no anatomy) |
| 19f | User interaction and expertise required | 3.5, 4 (second tier routed to a professional, never pushed to a patient alone) |
| 19g | Next steps | 5, "Next steps" |

## TRIPOD-LLM for Abstracts

The separate checklist for abstracts (Table 3 of the guideline), against the paper's abstract.

| Item | What it asks for | Where in the abstract |
|---|---|---|
| 2a | Title names an LLM evaluation, the task, population and outcome | Title |
| 2b | Healthcare context and rationale | Background, first three sentences |
| 2c | Objectives, and whether development, tuning or evaluation | Background, last sentence: an evaluation |
| 2d | Key elements of the setting | Methods: MIMIC-IV-Note, one US academic medical centre |
| 2e | Data used, splits, selective use | Methods: 350 random and 150 cue-enriched; developed on 150, scored on 350 |
| 2f | Name and version of the LLM | Methods: qwen2.5:7b-instruct, as released |
| 2g | LLM-building steps | Not applicable (M, D): no fine-tuning, stated in Methods |
| 2h | Task, inputs and outputs | Methods: three stages, quotes checked against the source |
| 2i | Evaluation data, held out, measures | Methods and Results: held-out 350, recall, precision, false positives |
| 2j | Main results and interpretation | Results |
| 2k | Broader implications or concerns | Conclusions |
| 2l | Registration | Methods, last sentence: not registered |
