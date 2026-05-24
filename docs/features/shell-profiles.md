# Shell Profiles

Each pane in Vibe99 can run a different shell or command. Shell Profiles let you define and manage these configurations — bash, zsh, SSH, Docker, or any command.

## Profile Types

### Built-in Profiles
Automatically detected and available:
- System shells (bash, zsh, fish, etc.)
- WSL distributions (Windows only)

### Custom Profiles
Create profiles for:
- Remote SSH connections
- Docker containers
- Custom applications
- Any executable command

## Managing Profiles

### Open Settings

1. Click the gear icon in the toolbar
2. Go to "Shell Profiles" section

### Create a Profile

1. Click the `+` button
2. Fill in:
   - **Name**: Display label (e.g., "Docker", "Production SSH")
   - **ID**: Unique identifier (auto-generated from name)
   - **Command**: Executable path (e.g., `/usr/bin/docker`)
   - **Arguments**: Command arguments (e.g., `exec -it container bash`)

### Edit a Profile

1. Select an existing profile
2. Modify the fields
3. Changes save automatically

### Set Default Profile

1. Select a profile
2. Click the `★` star button
3. New panes will use this profile by default

### Clone a Profile

1. Select a profile
2. Click the `⧉` clone button
3. Modify the copy as needed

### Reorder Profiles

Drag profiles in the list to change their display order.

## Using Profiles

### New Pane with Profile Picker

- Press `Ctrl+Shift+N`
- Select a profile from the list
- Pane opens with that profile

### Change Existing Pane Profile

1. Right-click inside a terminal
2. Go to "Change Profile"
3. Select a profile
4. Pane immediately switches to the new shell

## Demonstration

![Profile management](../gifs/profile-management.gif)

*Shows creating custom profiles and using them in different panes.*

## Profile Examples

### SSH Connection
- Name: "Production Server"
- Command: `/usr/bin/ssh`
- Arguments: `user@server.example.com`

### Docker Container
- Name: "PostgreSQL"
- Command: `/usr/bin/docker`
- Arguments: `exec -it postgres psql`

### Python REPL
- Name: "Python"
- Command: `/usr/bin/python3`
- Arguments: (empty)

## Tips

- Auto-detected profiles (system shells, WSL) cannot be edited — clone them to customize
- Each pane's profile is saved and restored on restart
- Profiles are stored in settings.json
- Use profiles to quickly access different environments

## Persistence

Profiles are part of session state:
- Each pane remembers its profile
- Restoring a layout restores the profile for each pane
- Profile changes apply immediately to the current pane
