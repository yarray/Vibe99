Fix SSH shell profile command argument handling to correctly pass remote commands to the shell.

When using SSH profiles with commands like `ssh -t host bash -ic "zellij attach"`,
the arguments after the hostname are now space-joined into a single argument that
SSH passes to the remote shell. This ensures complex remote commands with multiple
words are executed correctly.
