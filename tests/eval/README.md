# Assistant eval

`npm test` proves the parts work. This proves the assistant answers.

It runs the real system prompt, the real agent loop, the real in-memory MCP
session and the real Cohere API against a fake Nimble — so the only thing not
exercised is the database. Each scenario is a question someone would actually
type, plus a check on what came back: which tool ran, what the reply said, and
what changed in the data.

```sh
npm run eval                                            # every scenario, 3 runs each
npm run eval -- --runs 5                                # more runs, tighter signal
npm run eval -- --only sprint-progress                  # one scenario
npm run eval -- --model command-a-03-2025               # compare models
```

Needs `COHERE_API_KEY` in `.env`. It costs tokens, so it is deliberately not
part of `npm test`.

## Reading the output

```
PASS   my-work          3/3
FLAKY  count            2/3
         · wrong or missing count (want 6)
FAIL   sprint-progress  0/3
         · did not read sprint progress

OVERALL 30/36 (83%)  avg turns 1.9  avg API calls 2.7
```

The model is not deterministic, so a scenario is run several times. `FLAKY` is
the interesting result: it usually means the model can reach the answer but
something — an ambiguous tool description, a required argument it keeps
dropping — is making it a coin toss.

`avg API calls` is worth watching. A rise means the assistant is re-fetching
what it already had.

## Adding a scenario

Add to `SCENARIOS` in `run.js`. A `check` returns `null` to pass, or a short
reason to fail:

```js
{
  id: "backlog",
  turns: ["what's in the backlog?"],
  context: { projectId: 1 },
  check: ({ reply, toolCalls, db, perTurn }) => {
    if (!called(toolCalls, "get_backlog")) return "did not call get_backlog";
    if (!said(reply, "csv")) return "missed the CSV export story";
    return null;
  },
}
```

`turns` may hold several questions; the conversation is carried between them
exactly as `app/assistant/index.js` carries it, so follow-ups ("the first one",
"assign it to Carol") are testable. `perTurn[n]` holds that turn's tool and API
call counts, which is how you assert that a follow-up did *not* redo the work.

**When the assistant gets something wrong in the panel, add the scenario before
fixing it.** That is the difference between "it felt better after that change"
and knowing it was.

## The fixture

`fixture.js` is a small Nimble: two projects, eight stories, sprints, members,
acceptance criteria and activity. Shapes match what the real controllers return,
including the generous eager-loading. It is deliberately awkward in the ways
real data is — a completed story, an unestimated blocker, a story whose assignee
and reviewer differ, one project with no sprints at all.

Writes mutate the fixture, so a check can assert on `db` that the change
actually landed rather than trusting the model's word for it.
