// Firebase設定
const firebaseConfig = {
  apiKey: 'AIzaSyBMrbv0mMYYdPd-yoVyxQWl_0u30w_xglU',
  authDomain: 'daikou-app-c821a.firebaseapp.com',
  databaseURL: 'https://daikou-app-c821a-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'daikou-app-c821a',
  storageBucket: 'daikou-app-c821a.firebasestorage.app',
  messagingSenderId: '539006769589',
  appId: '1:539006769589:web:5dc0eb37687eb19c3ea1fc',
};

firebase.initializeApp(firebaseConfig);
// dbはfirebase.jsで宣言するため、ここでは宣言しない
