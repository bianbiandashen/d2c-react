'use server'

import { headers } from "next/headers";
import { redirect } from 'next/navigation';
import axios from 'axios';
import { cookies } from 'next/headers';
import admin from "../firebase/server";
import { stripe } from "../lib/stripe";
const db = admin.firestore();

export async function login(user, redirectURL) {
  const uid = user.uid;
  const userRef = db.collection("users").doc(uid);
  const userSnapshot = await userRef.get();
  cookies().set("session-cookie", uid);
  
  if (userSnapshot.exists) {
    redirect(redirectURL);
  } else {
    await db.collection("users").doc(uid).set(user);
    redirect(redirectURL);
  }
}

export async function logout() {
  cookies().delete("session-cookie");
  redirect("/login");
}

export async function getUserByUid(uid) {
  const userRef = db.collection("users").doc(uid);
  const userSnapshot = await userRef.get();
  return userSnapshot.exists? userSnapshot.data() : null;
}

export async function checkAPIKey(apiKey) {
  const OPENAI_API_URL = 'https://api.openai.com/v1/engines';

  try {
    const response = await axios.get(OPENAI_API_URL, {
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });

    if (response.status === 200) {
      console.log("The OpenAI API key is valid.");
      return {
        success: true,
        message: "The OpenAI API key is valid."
      };
    }
  } catch (error) {
    if (error.response && error.response.status === 401) {
      // A 401 error indicates that the key is invalid or expired
      console.log("The OpenAI API key is invalid or expired.");
      return {
        success: false,
        message: "The OpenAI API key is invalid or expired."
      };
    } else {
      console.log("There was an error checking the OpenAI API key:", error.message);
      return {
        success: false,
        message: `There was an error checking the OpenAI API key:", ${error.toString()}`
      };
    }
  }
}

export async function checkSubscription(subscriptionId) {
  try {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    
    if (subscription.status === 'active') {
      console.log("The subscription is active.");
      return {
        success: true,
        message: "The subscription is active."
      }
    } else {
      console.log(`The subscription is not active. Current status: ${subscription.status}`);
      return {
        success: false,
        message: `The subscription is not active. Current status: ${subscription.status}`
      }
    }
  } catch (error) {
    console.error("Error fetching subscription:", error);
    return {
      success: false,
      message: `Error fetching subscription: ${error.toString()}`
    }
  }

  return false;
}

export async function checkAccess(uid) {
  const userRef = db.collection("users").doc(uid);
  const userData = (await userRef.get()).data() || null;
  
  if (userData) {
    if (userData.count > 2) {
      const openai = userData.openAIKey ? (await checkAPIKey(userData.openAIKey)).success : false;
      const subscription = userData.subscription? (await checkSubscription(userData.subscription)).success : false;

      if (openai || subscription) {
        return {
          success: true,
          apiKey: userData.openAIKey
        };
      }
      else {
        return {
          success: false,
          apiKey: ""
        };
      }
    }
    else {
      return {
        success: true,
        apiKey: ""
      };
    }
  }

  return {
    success: false,
    apiKey: ""
  };
}

export async function saveAPIKey(uid, apiKey) {
  const userRef = db.collection("users").doc(uid);

  if (apiKey) {
    const res = await checkAPIKey(apiKey);
    if (res.success) {
      await userRef.update({
        openAIKey: apiKey
      });
      return true;
    }
    else {
      throw new Error(res.message);
    }
  }
  else {
    await userRef.update({
      openAIKey: ""
    });
    return true;
  }

}

export async function getSubscriptionData(uid) {
  const userRef = db.collection("users").doc(uid);
  const userData = (await userRef.get()).data() || null;

  let resData = {
    key: {},
    sub: {}
  };

  if (userData) {
    if (userData.openAIKey) {
      const res = await checkAPIKey(userData.openAIKey);
      resData = {
        ...resData,
        key: {
          ...res,
          openAIKey: userData.openAIKey
        }
      };
    }
    if (userData.subscription) {
      const res = await checkSubscription(userData.subscription);
      resData = {
        ...resData,
        sub: {
          ...res,
          subscription: userData.subscription
        }
      };
    }
    return resData;
  }
  return resData;
}

export async function createStripeCheckoutSession(uid) {
  const userRef = db.collection("users").doc(uid);
  const userData = (await userRef.get()).data() || null;

  if (userData) {
    const checkoutSession = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: userData.email,
      line_items: [{
        price: process.env.NEXT_PUBLIC_STRIPE_PRODUCT_ID,
        quantity: 1
      }],
      success_url: `${headers().get("origin")}/api/subscription?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${headers().get("origin")}/subscribe`
    });

    redirect(checkoutSession.url);
  }
}

export async function cancelSubscripion(uid, subscriptionId) {
  const userRef = db.collection("users").doc(uid);
  const userData = (await userRef.get()).data() || null;

  if (userData && userData.subscription) {
    await stripe.subscriptions.cancel(userData.subscription);
  }

  redirect("/subscribe");
}

export async function checkCount() {
  const uid = cookies().get("session-cookie").value.toString();
  
  const userRef = db.collection("users").doc(uid);
  const userData = (await userRef.get()).data() || null;
  
  if (userData) {
    if (userData.count > 2) {
      const res = await checkAccess(uid);
      console.log(res);
      if (!res.success) {
        redirect("/subscribe");
      }
    }

    await userRef.update({
      count: userData.count + 1
    });
  }
}