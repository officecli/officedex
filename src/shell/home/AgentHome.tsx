import { FileList } from "./FileList";
import { Hero } from "./Hero";
import { Highlights } from "./Highlights";
import { TaskList } from "./TaskList";
import "./home.css";

/**
 * Agent mode's Home: state a goal, then pick what to work on.
 *
 * Layout only. Each band owns its own data and its own file, so the four of
 * them can be worked on at once without meeting in this one — which is what
 * this component used to be, and why every change to Home collided.
 */
export function AgentHome() {
  return (
    <div className="shell-home shell-region shell-home--agent">
      <Hero />
      <Highlights />
      <TaskList />
      <FileList />
    </div>
  );
}
