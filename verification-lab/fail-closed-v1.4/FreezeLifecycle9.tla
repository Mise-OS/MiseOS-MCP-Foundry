---- MODULE FreezeLifecycle9 ----
EXTENDS Integers, Sequences, FiniteSets, TLC

ClaimIds == {"lattice_node_5", "lattice_node_6", "subsystem_entropy",
             "global_entropy", "dago_bellon", "ai_catastrophe_joint",
             "mit_delphi", "ord_judgment", "doomsday_clock"}
MaxVer == 3
Eval == {"pass", "fail", "indeterminate"}
Auth == {"allow", "deny", "deny_promotion", "unsupported", "historical_only", "reported_only"}

\* @type: Str => Str;
Proposition(id) ==
  CASE id = "lattice_node_5" -> "The four observed code strings uniquely determine 395-9636 as the hidden code for Node 5."
    [] id = "lattice_node_6" -> "The four observed code strings uniquely determine 243-7749 as the hidden code for Node 6."
    [] id = "subsystem_entropy" -> "A subsystem may decrease entropy with complete information, work, memory, feedback, bath, and exported entropy accounting."
    [] id = "global_entropy" -> "A closed macroscopic system can undergo engineered cost-free global entropy reversal."
    [] id = "dago_bellon" -> "The Dago-Bellon preprint reports apparent sub-Landauer behavior under a nonequilibrium feedback bath."
    [] id = "ai_catastrophe_joint" -> "The MIT Delphi establishes a single joint 2030 probability of AI catastrophe."
    [] id = "mit_delphi" -> "The MIT Delphi reports category-wise expert probability judgments."
    [] id = "ord_judgment" -> "Ord's existential-risk figures are expert judgments rather than measured frequencies."
    [] OTHER -> "The Doomsday Clock is a warning index rather than a calibrated catastrophe probability."

Propositions == { Proposition(id) : id \in ClaimIds }

\* @typeAlias: claimRec = {id: Str, ver: Int, proposition: Str, evaluation_status: Str, requirements_satisfied: Bool, authority: Str, supersedes: Int};
typeAliases == TRUE

Claim == [
  id: ClaimIds,
  ver: 1..MaxVer,
  proposition: Propositions,
  evaluation_status: Eval,
  requirements_satisfied: BOOLEAN,
  authority: Auth,
  supersedes: 0..MaxVer
]

VARIABLE
  \* @type: Str -> Seq($claimRec);
  claims
VARIABLE
  \* @type: Str;
  active
vars == <<claims, active>>

\* @type: ($claimRec) => Bool;
SafeAuthority(c) ==
  /\ (c.authority = "allow" => /\ c.evaluation_status = "pass" /\ c.requirements_satisfied = TRUE)
  /\ (c.evaluation_status = "indeterminate" => c.authority # "allow")
  /\ (c.evaluation_status = "fail" => c.authority # "allow")

\* @type: Str => $claimRec;
Seed(id) ==
  [ id |-> id,
    ver |-> 1,
    proposition |-> Proposition(id),
    evaluation_status |-> CASE id = "subsystem_entropy" -> "pass"
       [] id = "mit_delphi" -> "pass"
       [] id = "ord_judgment" -> "pass"
       [] id = "doomsday_clock" -> "pass"
       [] OTHER -> "indeterminate",
    requirements_satisfied |-> id \in {"subsystem_entropy", "mit_delphi", "ord_judgment", "doomsday_clock"},
    authority |-> CASE id = "subsystem_entropy" -> "allow"
       [] id \in {"mit_delphi", "ord_judgment", "doomsday_clock", "dago_bellon"} -> "reported_only"
       [] OTHER -> "deny_promotion",
    supersedes |-> 0 ]

TypeOK ==
  /\ DOMAIN claims = ClaimIds
  /\ active \in ClaimIds
  /\ \A id \in ClaimIds:
       /\ Len(claims[id]) \in 1..MaxVer
       /\ \A i \in 1..Len(claims[id]): claims[id][i] \in Claim

Init ==
  /\ claims = [id \in ClaimIds |-> <<Seed(id)>>]
  /\ active \in ClaimIds
  /\ \A id \in ClaimIds: SafeAuthority(Seed(id))

\* @type: (Str, Str, Bool, Str) => Bool;
CreateSuccessor(id, eval, req, auth) ==
  /\ id = active
  /\ Len(claims[id]) < MaxVer
  /\ eval \in Eval /\ req \in BOOLEAN /\ auth \in Auth
  /\ (auth = "allow" => /\ eval = "pass" /\ req = TRUE)
  /\ (eval = "indeterminate" => auth = "deny_promotion")
  /\ (eval = "fail" => auth = "deny")
  /\ LET v == Len(claims[id])
         old == claims[id][v]
         neu == [id |-> id, ver |-> v + 1, proposition |-> old.proposition,
                 evaluation_status |-> eval, requirements_satisfied |-> req,
                 authority |-> auth, supersedes |-> v]
     IN /\ claims' = [claims EXCEPT ![id] = Append(@, neu)]
        /\ active' = active

Next == \E id \in ClaimIds, e \in Eval, r \in BOOLEAN, a \in Auth: CreateSuccessor(id,e,r,a)
Spec == Init /\ [][Next]_vars

AllowImpliesPass ==
  \A id \in ClaimIds: \A i \in 1..Len(claims[id]):
    claims[id][i].authority = "allow" =>
      /\ claims[id][i].evaluation_status = "pass"
      /\ claims[id][i].requirements_satisfied = TRUE

IndeterminateNeverAllow ==
  \A id \in ClaimIds: \A i \in 1..Len(claims[id]):
    claims[id][i].evaluation_status = "indeterminate" => claims[id][i].authority # "allow"

LineageOK ==
  \A id \in ClaimIds: \A i \in 1..Len(claims[id]):
    /\ claims[id][i].id = id
    /\ claims[id][i].ver = i
    /\ claims[id][i].supersedes = IF i = 1 THEN 0 ELSE i - 1
    /\ claims[id][i].proposition = claims[id][1].proposition

Inv == /\ TypeOK /\ AllowImpliesPass /\ IndeterminateNeverAllow /\ LineageOK
====
