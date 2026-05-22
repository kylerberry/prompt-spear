#!/usr/bin/env node
import { Command } from 'commander';

const program = new Command();

program
  .name('prompt-spear')
  .description('Audit LLM endpoints against prompt injection and jailbreak attacks.')
  .version('0.0.0');

program.parse();
