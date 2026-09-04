import { useEffect } from 'react';
import { useRouter } from 'next/router';

// The old flat Tasks list+form was replaced by the Task lifecycle
// workflow: Task Backlog (/tasks/backlog), My Tasks (/tasks/mine), and
// the per-task detail page (/tasks/[id]). Redirect any old links/
// bookmarks here to My Tasks.
export default function TasksIndexRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/tasks/mine');
  }, [router]);

  return null;
}
