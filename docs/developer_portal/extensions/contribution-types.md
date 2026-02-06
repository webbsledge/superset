---
title: Contribution Types
sidebar_position: 5
---

<!--
Licensed to the Apache Software Foundation (ASF) under one
or more contributor license agreements.  See the NOTICE file
distributed with this work for additional information
regarding copyright ownership.  The ASF licenses this file
to you under the Apache License, Version 2.0 (the
"License"); you may not use this file except in compliance
with the License.  You may obtain a copy of the License at

  http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing,
software distributed under the License is distributed on an
"AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
KIND, either express or implied.  See the License for the
specific language governing permissions and limitations
under the License.
-->

# Contribution Types

Extensions provide functionality through **contributions** - well-defined extension points that integrate with the host application.

## Why Contributions?

The contribution system provides several key benefits:

- **Transparency**: Administrators can review exactly what functionality an extension provides before installation. The `manifest.json` documents all REST APIs, MCP tools, views, and other contributions in a single, readable location.

- **Security**: Only contributions explicitly declared in the manifest are registered during startup. Extensions cannot expose functionality they haven't declared, preventing hidden or undocumented code from executing.

- **Discoverability**: The manifest serves as a contract between extensions and the host application, making it easy to understand what an extension does without reading its source code.

## How Contributions Work

Contributions are automatically inferred from source code during build. The build tool scans your code and generates a `manifest.json` with all discovered contributions.

For advanced use cases, contributions can be manually specified in `extension.json` (overrides auto-discovery).

## Backend Contributions

### REST API Endpoints

Register REST APIs under `/api/v1/extensions/`:

```python
from superset_core.api import RestApi, extension_api
from flask_appbuilder import expose

@extension_api(id="my_api", name="My Extension API")
class MyExtensionAPI(RestApi):
    @expose("/endpoint", methods=["GET"])
    def get_data(self):
        return self.response(200, result={"message": "Hello"})
```

### MCP Tools

Register MCP tools for AI agents:

```python
from superset_core.mcp import tool

@tool(tags=["database"])
def query_database(sql: str, database_id: int) -> dict:
    """Execute a SQL query against a database."""
    return execute_query(sql, database_id)
```

### MCP Prompts

Register MCP prompts:

```python
from superset_core.mcp import prompt

@prompt(tags={"analysis"})
async def analyze_data(ctx, dataset: str) -> str:
    """Generate analysis for a dataset."""
    return f"Analyze the {dataset} dataset..."
```

See [MCP Integration](./mcp) for more details.

## Frontend Contributions

### Views

Add panels or views to the UI:

```json
"frontend": {
  "contributions": {
    "views": {
      "sqllab": {
        "panels": [
          {
            "id": "my_extension.main",
            "name": "My Panel Name"
          }
        ]
      }
    }
  }
}
```

### Commands

Define executable commands:

```json
"frontend": {
  "contributions": {
    "commands": [
      {
        "command": "my_extension.copy_query",
        "icon": "CopyOutlined",
        "title": "Copy Query",
        "description": "Copy the current query"
      }
    ]
  }
}
```

### Menus

Add items to menus:

```json
"frontend": {
  "contributions": {
    "menus": {
      "sqllab": {
        "editor": {
          "primary": [
            {
              "view": "builtin.editor",
              "command": "my_extension.copy_query"
            }
          ],
          "secondary": [
            {
              "view": "builtin.editor",
              "command": "my_extension.prettify"
            }
          ],
          "context": [
            {
              "view": "builtin.editor",
              "command": "my_extension.clear"
            }
          ]
        }
      }
    }
  }
}
```

### Editors

Replace the default text editor:

```json
"frontend": {
  "contributions": {
    "editors": [
      {
        "id": "my_extension.monaco_sql",
        "name": "Monaco SQL Editor",
        "languages": ["sql"]
      }
    ]
  }
}
```

See [Editors Extension Point](./extension-points/editors) for implementation details.

## Configuration

### extension.json

Specify which files to scan for contributions:

```json
{
  "id": "my_extension",
  "name": "My Extension",
  "version": "1.0.0",
  "backend": {
    "entryPoints": ["my_extension.entrypoint"],
    "files": ["backend/src/**/*.py"]
  },
  "frontend": {
    "moduleFederation": {
      "exposes": ["./index"]
    }
  }
}
```

### Manual Contributions (Advanced)

Override auto-discovery by specifying contributions directly:

```json
{
  "backend": {
    "contributions": {
      "mcpTools": [
        { "id": "query_db", "name": "query_db", "module": "my_ext.tools.query_db" }
      ],
      "restApis": [
        { "id": "my_api", "name": "My API", "module": "my_ext.api.MyAPI", "basePath": "/my_api" }
      ]
    }
  }
}
```
