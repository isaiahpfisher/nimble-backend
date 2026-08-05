> [!TIP]  
> View our [Entity Relationship Diagram](ERD.md).

# Nimble with Node

[![codecov](https://codecov.io/gh/isaiahpfisher/nimble-backend/branch/dev/graph/badge.svg)](https://codecov.io/gh/isaiahpfisher/nimble-backend/branch/dev)

Please visit https://github.com/isaiahpfisher/nimble-frontend for the frontend repository.

#### Please note:

- You will need to create a database and be able to run it locally.

## Project Setup

1. Clone the project into your **XAMPP/xamppfiles/htdocs** directory.

```
git clone https://github.com/isaiahpfisher/nimble-backend
```

2. Install the project.

```
npm install
```

3. Configure **Apache** to point to **Node** for API requests.
   - We recommend using XAMPP to serve this project.
   - In XAMPP, find the **Edit/Configure** button for **Apache**.
   - Edit the **conf** file, labeled **httpd.conf**.
   - It may warn you when opening it but open it anyway.
   - Add the following line as the **last line**:

   ```
   ProxyPass /nimbleapi http://localhost:3200/nimbleapi
   ```

   - Find the following line and remove the **#** at the front of the line.

   ```
   LoadModule proxy_http_module modules/mod_proxy_http.so
   LoadModule proxy_http2_module modules/mod_proxy_http2.so
   ```

   - Save the file.
   - **Restart Apache** and exit XAMPP.

4. Make a local **nimble_db** database.
   - Create a schema/database.
   - The Sequelize in this project will make all the tables for you.

5. Add a local **.env** file and make sure that the **database** variables are correct.
   - DB_HOST = 'localhost'
   - DB_PW = '**your-local-database-password**'
   - DB_USER = '**your-local-database-username**' (usually "root")
   - DB_NAME = '**your-local-database-name**' (example: "nimble_db")
   - SECRET_KEY = 'xT1tdO3CfMH01pjxC+guN1LWSt2nKvr5td6KUpw7Czg='

6. Initialize the database (optional).

   This project includes a seed and verification script at `scripts/init-db.js`.
   It creates sample data and runs a quick CRUD check.

```
npm run init-db
```

If you want to preserve existing tables and avoid dropping them, run:

```
npm run init-db:keep
```

To force a full table wipe and recreate everything explicitly:

```
npm run init-db:wipe
```

7. Compile and run the project locally.

```
npm run start
```

## The assistant

The in-app assistant lives in [`app/assistant/`](app/assistant/). It answers
from tools rather than from memory, and every tool reaches the database through
Nimble's own REST API using the caller's bearer token — so it can only ever see
what that user could see by hand, and authorization stays in one place.

```
app/assistant/
  index.js      the MCP wiring, and runChat — the entry point the app uses
  chat.js       the Cohere client and the agent loop: ask, run tools, ask again
  prompt.js     standing instructions (cross-cutting policy only)
  tools.js      the tool registry — one Zod schema per tool, no second copy
  generate.js   the one-shot drafting endpoints: no tools, no loop
```

### Two ways in

[`POST /nimbleapi/assistant/chat`](app/routes/assistant.routes.js#L6) is the
conversation. It takes the visible exchange plus whatever the page already knows
(`projectId`, `storyId`, `sprintId`) and gives the model a few turns to reach an
answer, running tools in between. It replies with the text and the list of tool
calls it made.

[`POST /nimbleapi/assistant/generate/:kind`](app/routes/assistant.routes.js#L7)
skips the loop and asks the model for one JSON object in a fixed shape. The
kinds are `acceptance_criteria`, `story_description` and `story_draft`. Nothing
it returns is saved — the drafts go back to the user, who decides.

Both routes require a bearer token, and both run as that user.

### The tools

| tool                      |                                                 |
| ------------------------- | ----------------------------------------------- |
| `get_projects`            | projects, teammates and managers                |
| `get_sprints`             | sprints and how they are going                  |
| `get_my_work`             | what the caller should work on, across projects |
| `find_stories`            | find stories in a project                       |
| `get_story`               | one story in full                               |
| `create_story`            | create a story _(write)_                        |
| `add_acceptance_criteria` | add criteria to a story _(write)_               |

Reads and writes are marked in the registry, and the two writes above are all
the assistant can change. Everything else it will tell you to do yourself.

### It is MCP all the way down

There is no shortcut path for the in-app assistant. [`index.js`](app/assistant/index.js)
builds an MCP server from the registry and connects a client to it over an
in-memory transport, so the assistant is just one more MCP client. The same
server is served to outside clients over stdio, which means Claude Desktop and
the MCP inspector get exactly what the in-app assistant gets:

```
NIMBLE_TOKEN=<bearer token> NIMBLE_USER_ID=<id> npm run mcp
npm run mcp:inspect
```

### Configuration

| variable              |                                                                       |
| --------------------- | --------------------------------------------------------------------- |
| `COHERE_API_KEY`      | switches the assistant on; without it the routes return 503 rather than failing at boot |
| `COHERE_MODEL`        | overrides the default model (`command-a-plus-05-2026`)                |
| `ASSISTANT_MAX_TURNS` | turns before the loop answers with whatever it has (default 6)        |
| `NIMBLE_API_URL`      | where the tools call back to (default `http://localhost:$PORT/nimbleapi`) |
