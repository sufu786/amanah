# Establishing priority: do this before talking to anyone

The objective is a **dated, public, citable record** naming you as the originator, plus prior art
that prevents anyone patenting this and locking you out of your own idea.

**Sequence matters.** Complete steps 1 to 3 *before* approaching any national programme, health
system, funder, accelerator or potential collaborator.

---

## Step 1. Register your ORCID (5 minutes)

Author is set: **Dedrani Mohamedsarfaraz Mohamadfiroz**. Use this exact form everywhere. It becomes
your permanent citation identity, and consistency across publications is what makes attribution
stick.

Register an **ORCID iD** at https://orcid.org (free, 3 minutes) and add it under the author line.
ORCID is the persistent identifier that ties this and every future publication to you specifically,
and disambiguates you from everyone sharing your name.

## Step 2. Get a DOI (30 minutes, free)

Publish `CONCEPT_NOTE.md` and `OBLIGATION_SPEC.md` to **Zenodo** (https://zenodo.org), which is
operated by CERN, free and permanent.

- Upload type: **Publication**, then **Preprint** (or *Working paper*)
- Licence: **CC BY 4.0**
- Add your ORCID
- Keywords: `follow-up`, `loss to follow-up`, `linkage to care`, `incidental findings`,
  `personal health record`, `global health`, `tuberculosis`, `hepatitis B`, `open source`
- Publish

You receive a **DOI** and a timestamp. That is the artefact. From that moment the concept is
publicly attributed to you on a date nobody can dispute, and it is prior art against any subsequent
patent application by anyone else.

Zenodo versions: later revisions get their own DOI plus a concept DOI covering all versions, so you
can keep publishing updates without losing the original priority date.

## Step 3. Public repository with signed commits (1 hour)

```bash
cd "C:/Users/banuf/OneDrive/Desktop/clinical-obligation-registry"
git init
git config user.name  "Dedrani Mohamedsarfaraz Mohamadfiroz"
git config user.email "s.dedrani786@gmail.com"

# Sign commits. This anchors the timeline cryptographically, not just by claim
git config commit.gpgsign true          # requires a GPG or SSH signing key configured

git add .
git commit -m "Portable clinical obligation: concept note and specification v0.1"
```

Push to a **public** GitHub repository. Add:

- `LICENSE`: **AGPL-3.0** for the eventual code
- `LICENSE-DOCS`: **CC BY 4.0** for the specification and concept note
- `CITATION.cff`: so GitHub renders a "Cite this repository" button pointing at your DOI
- The Zenodo DOI badge in the README

Enable the **Zenodo GitHub integration** so every future release automatically archives with a new
DOI. Provenance then maintains itself.

## Step 4. Claim the name: **Amanah** (same day, low cost)

The code can always be forked; the **name cannot be used by anyone else**. That is the durable
identity lever. It is how Linux, Rust and Kubernetes remain recognisable despite anyone being free
to copy them.

**Why this name.** Arabic *أمانة* means a trust: something entrusted to your keeping that you are
duty-bound to discharge and return. It states the concept rather than gesturing at it, and it is
natively understood in Arabic, Urdu, Swahili, Malay/Indonesian, Persian, Hausa and Turkish
(*emanet*), covering Nigeria, Indonesia, Pakistan, Bangladesh, India, East Africa and MENA, which
is substantially the map of global TB and hepatitis B burden. It carries no clinical claim, no
promise of cure, and no English-language dependency.

**Do today (low cost, high regret if skipped):**
- Register `amanah.health` / `amanah.org` or the closest available variant
- Claim the GitHub org, and the handles you care about
- Use the spelling **Amanah** consistently. It is more distinctive than *Amana*, and closer to the
  Malay/Urdu form

**Trademark clearance, before any launch or funding round:**
- Search classes **9** (software), **42** (SaaS), **44** (medical services) in your target
  jurisdictions
- Known adjacent uses of *Amana* sit in finance (Amana Mutual Funds, Amana Bank) and clinical
  services (Amana Healthcare, UAE). Different classes and a different spelling, but confirm rather
  than assume
- File once there is traction. Trademark is cheap relative to everything else here, and it is the
  only mechanism that actually stops someone shipping your project as theirs

**Keep the spec name separate.** `clinical-obligation-registry` / *Portable Clinical Obligation* is
descriptive: unprotectable as a mark, but exactly right for a specification. It is what makes the
work findable in literature searches, and its neutrality is what lets other parties implement the
standard without adopting your brand. The project ships as **Amanah**; the specification is cited as
the **Portable Clinical Obligation**.

## Step 5. Then, and only then, go outbound

With a DOI in hand:

- Preprint to **medRxiv** once you have extraction validation results (Phase 1 of the roadmap)
- Approach national TB programmes, DHIS2/OpenMRS communities, and funders
- Apply for grants (Wellcome, NIHR, EU Horizon, Gates Foundation for LMIC deployment)

Every one of those conversations is safer once the DOI exists, and every one of them is a disclosure
you cannot take back.

---

## What you are and are not claiming

Stating the claim at exactly the width it can bear is what makes it defensible. Overclaiming invites
a reviewer or competitor to dismantle the whole thing in an afternoon.

**Not novel, so cite it rather than claim it:**
- Institution-side follow-up tracking (Nuance mPower / PowerScribe Follow-up Manager: commercial,
  mature, deployed)
- LLM extraction of follow-up recommendations from radiology reports (published research, 2025)
- Patient-side record aggregation (Fasten Health, Apple Health Records)
- The observation that loss to follow-up is a problem (extensive literature)

**The claim:**

> A portable, patient-owned clinical obligation object that is condition-agnostic, source-agnostic
> (functioning from a photograph of a paper report with no institutional integration), globally
> deployable with graceful degradation, free and open source, and non-interpretive by design such
> that it falls outside medical device regulation, together with a registry that creates, tracks,
> escalates and closes such obligations only on evidence.

No existing system holds all six of those properties, and the combination is what removes the
integration, procurement and regulatory gates confining every mature implementation to wealthy
health systems.

---

## A note on patents

Publishing forfeits your own ability to patent this in most jurisdictions (absolute novelty; the US
allows a 12-month grace period). Given that the stated goal is free for everyone, that is the
intended outcome rather than a cost.

The asymmetric risk runs the other way: **if you keep this private and someone else files first, you
can be blocked from building your own idea.** Publication is the defence.
