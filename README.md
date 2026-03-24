# O2C Graph Intelligence System

## Overview
This project builds an intelligent system over an Order-to-Cash (O2C) dataset by transforming relational data into a graph and enabling natural language querying.

Users can:
- Explore entity relationships visually
- Query the system using natural language
- Receive data-backed responses grounded in the dataset

---

## Architecture

### Frontend
- HTML, CSS, JavaScript
- Interactive graph visualization
- Chat interface for querying

### Data Layer
- Dataset is converted into a graph structure using JavaScript objects
- Nodes represent business entities
- Edges represent relationships between entities

### Query Engine
- Custom query engine processes user queries
- Supports:
  - Aggregation queries (e.g., top products)
  - Flow tracing (Sales Order → Delivery → Billing → Journal)
  - Relationship exploration

---

## Graph Model

### Nodes
- SalesOrder
- Delivery
- BillingDocument
- JournalEntry
- Customer
- Product

### Relationships
- SalesOrder → Delivery
- Delivery → BillingDocument
- BillingDocument → JournalEntry
- SalesOrder → Customer
- OrderItem → Product

---

## Query Processing

1. User enters a natural language query
2. The system interprets the intent
3. Query is mapped to structured operations:
   - Aggregation (counts, rankings)
   - Graph traversal (flow tracing)
4. The query engine executes logic on the dataset
5. Results are returned in natural language

---

## LLM Prompting Strategy

- The LLM is used to interpret user queries and extract intent
- It does not generate answers directly
- Instead, it helps map queries to structured operations
- All responses are grounded in dataset-driven logic

---

## Guardrails

- The system restricts queries strictly to the O2C dataset
- Out-of-domain queries are rejected

Example:This system is designed to answer questions related to the provided dataset only."                                



---

## Example Queries

- Which products appear in the most billing documents?
- Trace the full flow of a billing document
- Identify incomplete sales flows

---

## Tech Stack

- HTML, CSS, JavaScript
- Graph-based data modeling
- OpenRouter (for natural language interpretation)

---
Note: For security reasons, API keys are not exposed in the public repository. The system includes a local query engine that handles dataset-based queries without relying on external APIs.
## Demo

https://o2c-graph-ui.onrender.com
