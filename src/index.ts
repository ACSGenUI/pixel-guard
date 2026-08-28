#!/usr/bin/env node
import { mcpServer } from './mcp-server.js';

await mcpServer.startStdio();
