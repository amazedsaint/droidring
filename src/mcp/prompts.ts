export interface PromptDef {
  name: string;
  description: string;
  arguments: Array<{ name: string; description: string; required: boolean }>;
  render: (args: Record<string, string>) => {
    role: 'user';
    content: { type: 'text'; text: string };
  };
}

export const PROMPTS: PromptDef[] = [
  {
    name: 'agent_handoff',
    description:
      'Hand off the current task to another agent by summarising state and posting to a chat room.',
    arguments: [
      { name: 'room', description: 'Room name or id to post into', required: true },
      { name: 'task', description: 'Short description of what needs to be done', required: true },
      {
        name: 'context',
        description: 'Pointers to files, PRs, or prior decisions',
        required: false,
      },
    ],
    render: (args) => ({
      role: 'user',
      content: {
        type: 'text',
        text: [
          `Please post a hand-off message in room "${args.room}" using the chat_send_message tool.`,
          '',
          'Structure the message as:',
          `  **Task:** ${args.task}`,
          args.context ? `  **Context:** ${args.context}` : '',
          '  **What I did:** <bullets>',
          '  **What is left:** <bullets>',
          '  **How to pick up:** <concrete next step>',
        ]
          .filter(Boolean)
          .join('\n'),
      },
    }),
  },
  {
    name: 'standup',
    description: 'Post a daily standup message into a chat room.',
    arguments: [
      { name: 'room', description: 'Room to post into', required: true },
      { name: 'yesterday', description: 'What was accomplished', required: true },
      { name: 'today', description: 'What will be worked on', required: true },
      { name: 'blockers', description: 'What is blocking', required: false },
    ],
    render: (args) => ({
      role: 'user',
      content: {
        type: 'text',
        text: [
          `Post the following standup in room "${args.room}" via chat_send_message:`,
          '',
          `**Yesterday:** ${args.yesterday}`,
          `**Today:** ${args.today}`,
          `**Blockers:** ${args.blockers || 'none'}`,
        ].join('\n'),
      },
    }),
  },
];
