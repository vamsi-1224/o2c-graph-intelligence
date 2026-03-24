# O2C Graph Intelligence System

## Overview
This project transforms an Order-to-Cash dataset into a graph-based system and enables natural language querying.

Users can explore relationships visually and query the system using natural language.

---

## Architecture

### Frontend
- HTML, CSS, JavaScript
- Graph visualization

### Data Layer
- Dataset modeled as a graph

### Query Engine
- Handles aggregation and flow queries

### LLM Strategy
- Natural language is interpreted into structured logic

---

## Graph Model

Nodes:
- Sales Orders
- Deliveries
- Billing Documents
- Journal Entries
- Customers
- Products

Relationships:
- Sales Order → Delivery → Billing → Journal
- Sales Order → Customer
- Item → Product

---

## Guardrails

Out-of-scope queries are rejected with:
"This system is designed to answer questions related to the dataset only."

---

## Demo

https://o2c-graph-ui.onrender.com
