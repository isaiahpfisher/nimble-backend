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

Set `COHERE_API_KEY` in `.env` to switch it on; without one the route returns
503 rather than failing at boot. `COHERE_MODEL` overrides the default model.

```
app/assistant/
  index.js      runChat — the only entry point the rest of the app uses
  loop.js       the agent loop: ask, run tools, ask again
  prompt.js     standing instructions (cross-cutting policy only)
  tools/        the tool registry — one Zod schema per tool, no second copy
  mcp.js        Nimble as an MCP server, and the assistant as one of its clients
  sessions.js   what the assistant remembers between requests
  context.js    filling in the ids the page already knows
```

### Tools over MCP

The same tools are served to outside clients over stdio, so Claude Desktop and
the MCP inspector get exactly what the in-app assistant gets:

```
NIMBLE_TOKEN=<bearer token> NIMBLE_USER_ID=<id> npm run mcp
npm run mcp:inspect
```

### Checking that it still works

`npm test` covers the parts. To check that the assistant actually *answers*,
run the eval — real prompt, real loop, real model, fake database:

```
npm run eval
```

See [`tests/eval/README.md`](tests/eval/README.md). It costs tokens, so it is
not part of `npm test`.
