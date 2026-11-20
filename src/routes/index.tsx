import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import CustomerLayout from "../components/layout/CustomerLayout";
import ProtectedRoute from "../components/common/ProtectedRoute";
import AdminLayout from "../admin/AdminLayout";
const AdminProducts = lazy(() => import("../admin/Products/Products"));
const AdminCategories = lazy(() => import("../admin/Categories/Categories"));
const AdminInventory = lazy(() => import("../admin/Inventory/Inventory"));
const AdminDashboard = lazy(() => import("../admin/Dashboard/Dashboard"));
const AdminCoupons = lazy(() => import("../admin/Coupons/Coupons"));
const AdminPayments = lazy(() => import("../admin/Payments/Payments"));
const AdminCustomRequests = lazy(() => import("../admin/CustomRequests/CustomRequests"));
const AdminSettings = lazy(() => import("../admin/Settings/Settings"));
import Home from "../pages/Home/Home";
import Shop from "../pages/Shop/Shop";
import CategoryPage from "../pages/Category/Category";
import PersonalisedGifts from "../pages/PersonalisedGifts/PersonalisedGifts";
import ProductDetails from "../pages/ProductDetails/ProductDetails";
import Login from "../pages/Login/Login";
import Register from "../pages/Register/Register";
import VerifyOTP from "../pages/VerifyOTP/VerifyOTP";
import Profile from "../pages/Profile/Profile";
const CustomerNotifications = lazy(() => import("../pages/Notifications/Notifications"));
import Cart from "../pages/Cart/Cart";
import Wishlist from "../pages/Wishlist/Wishlist";
import NotFound from "../pages/NotFound";
const MyRequests = lazy(() => import("../pages/MyRequests/MyRequests"));
const MyRequestDetails = lazy(() => import("../pages/MyRequests/MyRequestDetails"));
const Customize = lazy(() => import("../pages/Customize/Customize"));
const Checkout = lazy(() => import("../pages/Checkout/Checkout"));
const CheckoutSuccess = lazy(() => import("../pages/Checkout/CheckoutSuccess"));
const OrderPayment = lazy(() => import("../pages/Payment/OrderPayment"));
const MyOrders = lazy(() => import("../pages/MyOrders/MyOrders"));
const OrderDetails = lazy(() => import("../pages/MyOrders/OrderDetails"));
const OrderTracking = lazy(() => import("../pages/OrderTracking/OrderTracking"));
const ordersFallback = <p role="status" className="container-x py-24 text-center text-walnut/70">Loading your orders...</p>;
const checkoutFallback = <p role="status" className="container-x py-24 text-center text-walnut/70">Loading checkout...</p>;
const AdminCustomers = lazy(() => import("../admin/Customers/Customers"));
const AdminOrders = lazy(() => import("../admin/Orders/Orders"));
const AdminNotifications = lazy(() => import("../admin/Notifications/Notifications"));
const requestsFallback = <p role="status" className="container-x py-24 text-center text-walnut/70">Loading your requests...</p>;
const customizeFallback = <p role="status" className="container-x py-24 text-center text-walnut/70">Loading customization...</p>;
export default function AppRoutes() {
  return (
    <Routes>
      <Route element={<ProtectedRoute roles={["super_admin"]} />}>
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<Suspense fallback={<p role="status" className="py-12 text-center text-slate-300">Loading dashboard...</p>}><AdminDashboard /></Suspense>} />
          <Route path="products" element={<Suspense fallback={<p role="status" className="py-12 text-center text-slate-300">Loading products...</p>}><AdminProducts /></Suspense>} />
          <Route path="categories" element={<Suspense fallback={<p role="status" className="py-12 text-center text-slate-300">Loading categories...</p>}><AdminCategories /></Suspense>} />
          <Route path="inventory" element={<Suspense fallback={<p role="status" className="py-12 text-center text-slate-300">Loading inventory...</p>}><AdminInventory /></Suspense>} />
          <Route path="customers" element={<Suspense fallback={<p role="status" className="py-12 text-center text-slate-300">Loading customers...</p>}><AdminCustomers /></Suspense>} />
          <Route path="orders" element={<Suspense fallback={<p role="status" className="py-12 text-center text-walnut/70">Loading orders...</p>}><AdminOrders /></Suspense>} />
          <Route path="notifications" element={<Suspense fallback={<p role="status" className="py-12 text-center text-walnut/70">Loading notifications...</p>}><AdminNotifications /></Suspense>} />
          <Route path="coupons" element={<Suspense fallback={<p role="status" className="py-12 text-center text-slate-300">Loading coupons...</p>}><AdminCoupons /></Suspense>} />
          <Route path="payments" element={<Suspense fallback={<p role="status" className="py-12 text-center text-slate-300">Loading payments...</p>}><AdminPayments /></Suspense>} />
          <Route path="custom-requests" element={<Suspense fallback={<p role="status" className="py-12 text-center text-slate-300">Loading custom requests...</p>}><AdminCustomRequests /></Suspense>} />
          <Route path="settings" element={<Suspense fallback={<p role="status" className="py-12 text-center text-slate-300">Loading settings...</p>}><AdminSettings /></Suspense>} />
        </Route>
      </Route>
      <Route element={<CustomerLayout />}>
        <Route index element={<Home />} />
        <Route path="shop" element={<Shop />} />
        <Route path="personalised-gifts" element={<PersonalisedGifts />} />
        <Route path="category/:slug" element={<CategoryPage />} />
        <Route path="product/:slug" element={<ProductDetails />} />
        <Route path="login" element={<Login />} />
        <Route path="register" element={<Register />} />
        <Route path="verify-otp" element={<VerifyOTP />} />
        <Route path="cart" element={<Cart />} />
        <Route path="wishlist" element={<Wishlist />} />
        <Route element={<ProtectedRoute />}>
          <Route path="profile" element={<Profile />} />
          <Route path="notifications" element={<Suspense fallback={ordersFallback}><CustomerNotifications /></Suspense>} />
          <Route path="customize/:slug" element={<Suspense fallback={customizeFallback}><Customize /></Suspense>} />
          <Route path="checkout" element={<Suspense fallback={checkoutFallback}><Checkout /></Suspense>} />
          <Route path="checkout/success/:orderId" element={<Suspense fallback={checkoutFallback}><CheckoutSuccess /></Suspense>} />
          <Route path="payment/:orderId" element={<Suspense fallback={checkoutFallback}><OrderPayment /></Suspense>} />
          <Route path="my-requests" element={<Suspense fallback={requestsFallback}><MyRequests /></Suspense>} />
          <Route path="my-requests/:requestId" element={<Suspense fallback={requestsFallback}><MyRequestDetails /></Suspense>} />
          <Route path="my-orders" element={<Suspense fallback={ordersFallback}><MyOrders /></Suspense>} />
          <Route path="my-orders/:orderId" element={<Suspense fallback={ordersFallback}><OrderDetails /></Suspense>} />
          <Route path="track" element={<Suspense fallback={ordersFallback}><OrderTracking /></Suspense>} />
          <Route path="track/:orderRef" element={<Suspense fallback={ordersFallback}><OrderTracking /></Suspense>} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
