import { InputRule } from '@tiptap/core';
import { TaskList } from '@tiptap/extension-list';

export const TASK_ITEM_MARKER_REGEX = /^\[([ xX])\]\s$/;

export const TaskListWithMarkers = TaskList.extend({
  addInputRules() {
    return [
      new InputRule({
        find: TASK_ITEM_MARKER_REGEX,
        handler: ({ chain, range, match }) => {
          const checked = match[1]?.toLowerCase() === 'x';

          chain()
            .deleteRange(range)
            .toggleTaskList()
            .command(({ commands }) =>
              checked ? commands.updateAttributes('taskItem', { checked: true }) : true,
            )
            .run();
        },
      }),
    ];
  },
});
