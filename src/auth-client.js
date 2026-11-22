export async function connectAuth(config) {
  if (config.demo) return {
    token: async ()=>sessionStorage.getItem('mapsbrasil-demo-session'),
    demoLogin: async role=>{
      const result=await fetch('/api/demo',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({role})});
      if (!result.ok) throw Error('Demonstração indisponível.');
      sessionStorage.setItem('mapsbrasil-demo-session',(await result.json()).token);
    },
    logout:async()=>sessionStorage.removeItem('mapsbrasil-demo-session')
  };
  if (!config.firebase) return null;
  const [{initializeApp},sdk]=await Promise.all([import('@firebase/app'),import('@firebase/auth')]);
  const auth=sdk.getAuth(initializeApp(config.firebase));
  await auth.authStateReady();
  function call(fn) {
    return async (...args)=>{
      try { return await fn(...args); }
      catch (error) {
        const errors={
          'auth/invalid-credential':'E-mail ou senha inválidos.',
          'auth/invalid-email':'Informe um e-mail válido.',
          'auth/email-already-in-use':'Já existe uma conta com esse e-mail. Use Entrar com e-mail ou Redefinir senha.',
          'auth/weak-password':'A senha não atende à política do provedor.',
          'auth/popup-closed-by-user':'A janela de login foi fechada.',
          'auth/too-many-requests':'Muitas tentativas. Aguarde e tente novamente.'
        };
        throw Error(errors[error.code] ?? 'O provedor de identidade não concluiu a solicitação. Tente novamente.');
      }
    };
  }
  const verify=()=>sdk.sendEmailVerification(auth.currentUser);
  return {
    token:async()=>auth.currentUser?.getIdToken() ?? null,
    login:call(()=>sdk.signInWithPopup(auth,new sdk.GoogleAuthProvider())),
    emailLogin:call((email,password)=>sdk.signInWithEmailAndPassword(auth,email,password)),
    register:call(async(email,password)=>{
      await sdk.createUserWithEmailAndPassword(auth,email,password);
      await verify();
    }),
    resend:call(verify),
    reset:call(email=>sdk.sendPasswordResetEmail(auth,email)),
    checkVerification:call(async()=>{
      await sdk.reload(auth.currentUser);
      await auth.currentUser.getIdToken(true);
    }),
    logout:async()=>sdk.signOut(auth)
  };
}
