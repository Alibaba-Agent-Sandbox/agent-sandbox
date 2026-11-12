# Native expressions in template projects

Template v1 uses one resource file. Its Serving configuration follows the native
Devs project structure and preserves the selected component's props. The native
parser resolves references for Sandbox and application values through the same
project context; there is no separate template expression dialect.

For example, native `${env('MODEL_API_KEY')}` reads the named environment value,
and `${vars.model}` reads a project variable. Native `file` returns text; use
`${json(file('./values.json')).model}` to read a JSON property. Relative files
are resolved from the resource file's project directory.

Missing required references must stop preview or execution with an actionable
field location. Private values must stay out of public resource literals,
ordinary output, persisted plans and image build contexts. Static template
discovery must remain possible without evaluating credentials or local files.

Declaring a native action is different from running it. A plan must identify
declared actions; only an execution path that supports their real lifecycle may
execute them. Native component syntax alone does not establish general Serving
deployment, resource ownership or safe removal. Managed Agents retain their
explicit candidate verification, old Session routing and drain behavior.
