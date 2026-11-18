import { EventsConsts } from '../../../src/events/events-consts';
import ViewManipulator from '../../../src/utils/view-manipulator';
import PubSubService from '../../../src/events/pubsub-service';

describe('ViewManipulator module', () => {
	test('Should select the necessary dom elements', (done) => {
		const pubsub = new PubSubService();
		const viewMan = new ViewManipulator(pubsub);
		expect(viewMan.signInLink).toBeDefined();
		expect(viewMan.registerForm).toBeDefined();
		expect(viewMan.loginForm).toBeDefined();
		expect(viewMan.marketPlace).toBeDefined();
		expect(viewMan.btnCloseAlertMsg).toBeDefined();
		expect(viewMan.isOnLoginPage).toBeDefined();
		expect(viewMan.isOnLoginPage).toBeTruthy();
		done();
	});

	test('Should attach the necessary dom events listeners', () => {
		const pubsub = new PubSubService();
		const spy = jest.spyOn(ViewManipulator.prototype, 'attachViewListeners');
		new ViewManipulator(pubsub);
		expect(spy).toHaveBeenCalledTimes(1);
		spy.mockRestore();
	});

	test('Should be subscribed to the LOGOUT pubsub event', () => {
		const pubsub = new PubSubService();
		const spy = jest.spyOn(pubsub, 'subscribe');
		new ViewManipulator(pubsub);
		expect(spy).toHaveBeenCalledWith(EventsConsts.LOGOUT, expect.any(Function));
		spy.mockRestore();
	});

	test('Should provide a method for manipulating alert messages', (done) => {
		const elAlertMsg = document.createElement('div');
		const elMessageText = document.createElement('div');
		elMessageText.setAttribute('id', 'messageText');
		elAlertMsg.appendChild(elMessageText);
		ViewManipulator.toggleErrorMessageView(elAlertMsg, 'test text', true);

		expect(elAlertMsg.style.display).toEqual('block');
		expect(elMessageText.innerText).toEqual('test text');

		ViewManipulator.toggleErrorMessageView(elAlertMsg, 'test text', false);

		expect(elAlertMsg.style.display).toEqual('none');
		done();
	});

	test('Should provide a method for showing/hiding a given element', (done) => {
		 const el = document.createElement('div');
		 el.setAttribute('id', 'dauber');
		 document.body.appendChild(el);
		 ViewManipulator.toggleVisibility(el, false);
		 expect(el.style.display).toEqual('none');
		 done();
	 });

	test('Should provide a method for updating the view/screen state', (done) => {
		const elGameWrapper = document.createElement('div');
		const elRegisterPage = document.createElement('div');
		let isLoggedIn = false;

		ViewManipulator.updateViewState(elGameWrapper, elRegisterPage, isLoggedIn);
		expect(elGameWrapper.style.display).toEqual('none');
		expect(elRegisterPage.style.display).toEqual('block');

		isLoggedIn = true;

		ViewManipulator.updateViewState(elGameWrapper, elRegisterPage, isLoggedIn);
		expect(elGameWrapper.style.display).toEqual('block');
		expect(elRegisterPage.style.display).toEqual('none');
		done();
	});
});
