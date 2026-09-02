inductive Eval
  | pass
  | fail
  | indeterminate
  deriving DecidableEq

inductive Auth
  | allow
  | deny
  | denyPromotion
  deriving DecidableEq

def authority (e : Eval) (requirementsSatisfied : Bool) : Auth :=
  match e, requirementsSatisfied with
  | .pass, true          => .allow
  | .fail, _             => .deny
  | .indeterminate, _    => .denyPromotion
  | .pass, false         => .denyPromotion

theorem allow_requires_pass (e : Eval) (r : Bool) :
    authority e r = .allow → e = .pass := by
  cases e <;> cases r <;> simp [authority]

theorem indeterminate_never_allows (r : Bool) :
    authority .indeterminate r ≠ .allow := by
  cases r <;> simp [authority]

theorem preservation_not_authorization
    (candidatePreserved : Bool) (e : Eval) (r : Bool)
    (h : e = .indeterminate) :
    candidatePreserved = true → authority e r ≠ .allow := by
  intro _
  subst e
  exact indeterminate_never_allows r
