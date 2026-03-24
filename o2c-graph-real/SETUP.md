# Project Setup Instructions

## Overview
This is a frontend-only application for visualizing and querying an Order-to-Cash (O2C) dataset as a graph.

No backend or database setup is required.

---

## Option 1: Run Directly (Simplest)

1. Download the repository:
   - Go to GitHub
   - Click "Code" → "Download ZIP"

2. Extract the ZIP file

3. Open the folder:

o2c-graph-intelligence/o2c-graph-real   


4. Double-click:

index.html


5. The application will open in your browser

---

## Option 2: Run Using VS Code (Recommended)

1. Open the project folder in VS Code

2. Install the "Live Server" extension

3. Right-click `index.html`

4. Click:Open with Live Server


5. The app will open in your browser

---

## How to Use the Application

- View the graph of entities and relationships
- Use the chat interface to query the dataset

### Example Queries

- Which products appear in the most billing documents?
- Trace the flow of a billing document
- Identify incomplete sales flows

---

## Guardrails

The system only answers dataset-related queries.

Example:

This system is designed to answer questions related to the provided dataset only.


---

## Note on API Usage

For security reasons, API keys are not included in this repository.

The system uses a dataset-driven query engine to process queries without relying on external APIs.





---

## Optional: Enable LLM (OpenRouter API)

The application supports natural language understanding using OpenRouter.

⚠️ This step is optional. The app works without API using dataset-based queries.

---

### 1. Create an OpenRouter API Key

1. Go to:
   https://openrouter.ai/keys

2. Click:
   **Create Key**

3. Copy your API key

---

### 2. Add API Key to Project

Open the file:

o2c-graph-real/js/app.js


Find this line:
```js
var AI_KEY = '';

Replace it with:

var AI_KEY = 'your_api_key_here';