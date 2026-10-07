# The patient app (Phase 2)

A local app in which a patient checks the follow-up recommendations in their own report. See
`PHASE2_PLAN.md` for what it is for and the rules it follows.

```
ollama serve                 # the local model server, if it is not already running
node app/server.mjs          # then open http://127.0.0.1:4747
```

Options: `--port`, `--data <file>` for where follow-ups are kept (default `~/.amanah/obligations.json`),
and `--model`. Without the model server, the app still works: the patient marks recommendations
themselves.

Everything stays on the computer. The server answers only requests addressed to 127.0.0.1, the page
loads nothing from outside, and the report text is dropped once the patient has saved.

**Status:** stages 1 to 3 of six. Tested on invented reports only. No real report should be put
through it until the safety review in stage 6.

```
node --test app/
```
