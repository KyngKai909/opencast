// Signed in, but not on the Opencast team: the desk says so plainly, and offers signing out.
import { Button, Lockup } from "@opencast/ui";
import { useAuth } from "../auth/AuthProvider";
import "./SignIn.css";

export default function NotForYou({ error }: { error?: boolean }) {
  const auth = useAuth();
  return (
    <main className="nd-signin">
      <div className="nd-signin__card">
        <div className="nd-signin__mark">
          <Lockup size="phone" />
          <span className="nd-signin__internal">Internal</span>
        </div>
        {error ? (
          <>
            <h1 className="nd-signin__h">Network desk didn't open.</h1>
            <p className="nd-signin__p">We couldn't check who you are just now. Try again in a minute.</p>
          </>
        ) : (
          <>
            <h1 className="nd-signin__h">This desk is for the Opencast team.</h1>
            <p className="nd-signin__p">
              You're signed in{auth.email ? ` as ${auth.email}` : ""}, but that account isn't on the team. If you run a station, master control is where you run it.
            </p>
          </>
        )}
        <div className="nd-signin__row">
          <Button variant="ghost" onClick={() => void auth.signOut()}>
            Sign out
          </Button>
        </div>
      </div>
    </main>
  );
}
