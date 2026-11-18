const NumbersGenerator = {
	getRandomNumber (min, max) {
		if (max === undefined) {
			max = min;
			min = 0;
		}
		return Math.floor(Math.random() * (max - min + 1)) + min;
	},

	/**
	 * Do random generation of the numbers by columns:
	 * On a real Bingo card, each column has a different
	 * range of numbers: B is 1–15, I is 16–30, N is 31–45,
	 * G is 46–60, and O is 61–75
	 * @returns {Array}
	 */
	getColumnNumbers(arrNumbers, countNums = 5) {
		if (!Number.isInteger(countNums) || countNums < 0 || countNums > arrNumbers.length ||
			new Set(arrNumbers).size !== arrNumbers.length) {
			throw new RangeError('Expected distinct numbers and a valid sample size');
		}
		const available = arrNumbers.slice();
		for (let i = 0; i < countNums; i++) {
			const j = this.getRandomNumber(i, available.length - 1);
			[available[i], available[j]] = [available[j], available[i]];
		}
		return available.slice(0, countNums);
	}

};

export { NumbersGenerator };
