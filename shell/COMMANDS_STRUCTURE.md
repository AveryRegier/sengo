# Shell Commands Directory Structure

The shell commands have been refactored into a dedicated `shell/src/commands/` directory with each command in its own file for better organization and maintainability.

## Directory Structure

```
shell/src/
├── commands/
│   ├── index.ts                 # Exports all commands
│   ├── connectCommand.ts        # Connect to a repository
│   ├── closeCommand.ts          # Close the client connection
│   ├── useCommand.ts            # Select a collection
│   ├── exitCommand.ts           # Exit the shell
│   ├── helpCommand.ts           # Show help
│   ├── debugCommand.ts          # Toggle debug mode
│   └── defaultCommand.ts        # Default handler for collection methods
├── index.ts                     # Main shell entry point
├── parser.ts                    # Command line and JSON parsing utilities
└── types.ts
```

## File Organization

### Commands
Each command file exports a single class that implements:
- `name: string` - Command name
- `description: string` - Help description
- `run(args: any[], shell: SengoShell)` - Async method to execute the command

### Command Index
`shell/src/commands/index.ts` re-exports all command classes for convenient importing in the main shell.

### Main Shell
`shell/src/index.ts` now:
- Imports all commands from the commands directory
- Instantiates and registers them
- Handles command routing and execution
- Maintains the same API and behavior

## Benefits

- **Modularity**: Each command is isolated in its own file
- **Maintainability**: Easy to find and update specific commands
- **Scalability**: Simple to add new commands by creating new files
- **Testability**: Individual commands can be tested in isolation
- **Clarity**: The main shell file is more focused and readable
